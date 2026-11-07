/**
 * Rift Horizon — desktop shell (Electron).
 * Loads the static web build (offline Three via ./vendor when packaged).
 * Auto-update: download latest GitHub Release asset for this OS/arch and apply it
 * (Windows portable replace / setup, Linux AppImage replace / deb open, macOS zip → .app replace).
 */
const { app, BrowserWindow, shell, globalShortcut, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { spawn, execFile } = require('child_process');
const os = require('os');

const isDev = !app.isPackaged;
const gameRoot = isDev
  ? path.join(__dirname, '..')
  : path.join(process.resourcesPath, 'game');

function readVersion() {
  try {
    const v = fs.readFileSync(path.join(gameRoot, 'version.txt'), 'utf8').trim();
    if (v) return v;
  } catch (_) {}
  try {
    return require('./package.json').version || '0.0.0';
  } catch (_) {
    return '0.0.0';
  }
}

const APP_VERSION = readVersion();

/** Remember window bounds */
function boundsPath() {
  return path.join(app.getPath('userData'), 'window-bounds.json');
}
function loadBounds() {
  try {
    return JSON.parse(fs.readFileSync(boundsPath(), 'utf8'));
  } catch (_) {
    return null;
  }
}
function saveBounds(win) {
  if (!win || win.isDestroyed()) return;
  try {
    const b = win.getBounds();
    fs.writeFileSync(boundsPath(), JSON.stringify({ ...b, isMaximized: win.isMaximized() }));
  } catch (_) {}
}

function createWindow() {
  const prev = loadBounds();
  const win = new BrowserWindow({
    width: (prev && prev.width) || 1280,
    height: (prev && prev.height) || 720,
    x: prev && typeof prev.x === 'number' ? prev.x : undefined,
    y: prev && typeof prev.y === 'number' ? prev.y : undefined,
    minWidth: 960,
    minHeight: 540,
    backgroundColor: '#0a0c10',
    title: `Rift Horizon ${APP_VERSION}`,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  win.setMenu(null);

  if (prev && prev.isMaximized) win.maximize();

  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(gameRoot, 'index.html'));

  win.on('close', () => saveBounds(win));

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && (input.key === 'F11' || (input.alt && input.key === 'Enter'))) {
      event.preventDefault();
      win.setFullScreen(!win.isFullScreen());
    }
  });

  return win;
}

function downloadFile(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      try { fs.unlinkSync(dest); } catch (_) {}
      reject(err);
    };
    const get = (u, redirects) => {
      if (redirects > 8) return fail(new Error('Too many redirects'));
      const lib = u.startsWith('http:') ? http : https;
      const req = lib.get(u, { headers: { 'User-Agent': 'RiftHorizon-Updater' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return get(res.headers.location, redirects + 1);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return fail(new Error(`HTTP ${res.statusCode}`));
        }
        const total = Number(res.headers['content-length']) || 0;
        let received = 0;
        const file = fs.createWriteStream(dest);
        file.on('error', fail);
        res.on('data', (chunk) => {
          received += chunk.length;
          if (onProgress && total) onProgress(Math.min(0.99, received / total));
          else if (onProgress) onProgress(0.5);
        });
        res.on('error', fail);
        res.pipe(file);
        file.on('finish', () => {
          file.close(() => {
            if (settled) return;
            settled = true;
            if (onProgress) onProgress(1);
            resolve(dest);
          });
        });
      });
      req.on('error', fail);
    };
    get(url, 0);
  });
}

function shQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

/** Windows: after exit, copy portable exe over the running one and relaunch. */
function scheduleWindowsPortableReplace(downloadedPath) {
  const exePath = process.execPath;
  const bat = path.join(app.getPath('temp'), `rift-update-${Date.now()}.cmd`);
  const lines = [
    '@echo off',
    'setlocal',
    `set "SRC=${downloadedPath}"`,
    `set "DST=${exePath}"`,
    'echo Waiting for Rift Horizon to exit...',
    ':wait',
    'timeout /t 1 /nobreak >nul',
    `tasklist /FI "PID eq ${process.pid}" | find "${process.pid}" >nul`,
    'if not errorlevel 1 goto wait',
    'timeout /t 1 /nobreak >nul',
    'copy /Y "%SRC%" "%DST%" >nul',
    'if errorlevel 1 (',
    '  echo Copy failed — leaving downloaded file at %SRC%',
    '  start "" "%SRC%"',
    ') else (',
    '  del "%SRC%" >nul 2>&1',
    '  start "" "%DST%"',
    ')',
    'del "%~f0" >nul 2>&1',
  ];
  fs.writeFileSync(bat, lines.join('\r\n'), 'utf8');
  spawn('cmd.exe', ['/c', bat], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }).unref();
}

/**
 * Linux AppImage: replace the running AppImage (or drop next to it) after exit.
 * process.env.APPIMAGE is set when launched from an AppImage.
 */
function scheduleLinuxAppImageReplace(downloadedPath) {
  const target =
    process.env.APPIMAGE ||
    (process.execPath.endsWith('.AppImage') ? process.execPath : null);
  const script = path.join(app.getPath('temp'), `rift-update-${Date.now()}.sh`);
  const dst = target || path.join(app.getPath('home'), 'RiftHorizon.AppImage');
  const body = [
    '#!/bin/bash',
    'set -e',
    `SRC=${shQuote(downloadedPath)}`,
    `DST=${shQuote(dst)}`,
    `PID=${process.pid}`,
    'echo "Waiting for Rift Horizon to exit..."',
    'while kill -0 "$PID" 2>/dev/null; do sleep 0.5; done',
    'sleep 0.5',
    'chmod +x "$SRC"',
    'if cp -f "$SRC" "$DST"; then',
    '  chmod +x "$DST"',
    '  rm -f "$SRC"',
    '  ( "$DST" & )',
    'else',
    '  echo "Copy failed — launching downloaded AppImage"',
    '  ( "$SRC" & )',
    'fi',
    'rm -f -- "$0"',
  ].join('\n');
  fs.writeFileSync(script, body, { mode: 0o755 });
  spawn('bash', [script], { detached: true, stdio: 'ignore' }).unref();
}

/**
 * macOS: zip contains Rift Horizon.app — extract, then after exit replace the
 * running .app bundle (or install into /Applications) and relaunch.
 */
function findMacAppBundle() {
  // process.execPath ≈ .../Rift Horizon.app/Contents/MacOS/Rift Horizon
  let p = process.execPath;
  for (let i = 0; i < 6; i++) {
    if (p.endsWith('.app')) return p;
    const parent = path.dirname(p);
    if (parent === p) break;
    p = parent;
  }
  return null;
}

function scheduleMacZipReplace(downloadedZip) {
  const runningApp = findMacAppBundle();
  const destApp =
    runningApp ||
    path.join('/Applications', 'Rift Horizon.app');
  const work = path.join(app.getPath('temp'), `rift-mac-upd-${Date.now()}`);
  const script = path.join(app.getPath('temp'), `rift-update-${Date.now()}.sh`);
  const body = [
    '#!/bin/bash',
    'set -e',
    `ZIP=${shQuote(downloadedZip)}`,
    `WORK=${shQuote(work)}`,
    `DEST=${shQuote(destApp)}`,
    `PID=${process.pid}`,
    'echo "Waiting for Rift Horizon to exit..."',
    'while kill -0 "$PID" 2>/dev/null; do sleep 0.5; done',
    'sleep 1',
    'rm -rf "$WORK"',
    'mkdir -p "$WORK"',
    'unzip -q "$ZIP" -d "$WORK"',
    // Find the .app inside the zip (top-level or nested one level)
    'APP=$(find "$WORK" -maxdepth 2 -name "*.app" -type d | head -n 1)',
    'if [ -z "$APP" ]; then',
    '  echo "No .app in zip"',
    '  open "$WORK" || true',
    '  rm -f -- "$0"',
    '  exit 1',
    'fi',
    'rm -rf "$DEST"',
    'mkdir -p "$(dirname "$DEST")"',
    'cp -R "$APP" "$DEST"',
    'rm -rf "$WORK"',
    'rm -f "$ZIP"',
    'open "$DEST"',
    'rm -f -- "$0"',
  ].join('\n');
  fs.writeFileSync(script, body, { mode: 0o755 });
  spawn('bash', [script], { detached: true, stdio: 'ignore' }).unref();
}

function platformInfo() {
  return {
    platform: process.platform, // win32 | darwin | linux
    arch: process.arch, // x64 | arm64 | ia32
    appImage: !!process.env.APPIMAGE,
    version: APP_VERSION,
  };
}

ipcMain.handle('rift:get-version', () => APP_VERSION);
ipcMain.handle('rift:get-platform', () => platformInfo());

/**
 * opts: { url, version, kind }
 * kind: portable | setup | appimage | deb | maczip
 */
ipcMain.handle('rift:download-update', async (event, opts) => {
  const url = opts && opts.url;
  if (!url || typeof url !== 'string') throw new Error('Missing download URL');
  const kind = String((opts && opts.kind) || 'portable').toLowerCase();
  const version = (opts && opts.version) || 'update';
  const safeVer = String(version).replace(/[^\w.-]+/g, '_');

  const ext =
    kind === 'setup' || kind === 'portable'
      ? '.exe'
      : kind === 'appimage'
        ? '.AppImage'
        : kind === 'deb'
          ? '.deb'
          : kind === 'maczip'
            ? '.zip'
            : path.extname(url.split('?')[0]) || '.bin';

  const dest = path.join(
    app.getPath('temp'),
    `RiftHorizon-${safeVer}-update${ext}`
  );

  const sendProg = (p) => {
    try {
      if (!event.sender.isDestroyed()) event.sender.send('rift:update-progress', p);
    } catch (_) {}
  };

  await downloadFile(url, dest, sendProg);

  // --- apply ---
  if (kind === 'setup' || kind === 'deb') {
    // Installer / package manager UI
    try {
      if (process.platform === 'linux') {
        // Prefer xdg-open so the desktop handles .deb
        spawn('xdg-open', [dest], { detached: true, stdio: 'ignore' }).unref();
      } else {
        await shell.openPath(dest);
      }
    } catch (_) {
      shell.openExternal('file://' + dest);
    }
    setTimeout(() => app.quit(), 800);
    return { ok: true, kind, path: dest };
  }

  if (kind === 'portable' && process.platform === 'win32') {
    scheduleWindowsPortableReplace(dest);
    setTimeout(() => app.quit(), 600);
    return { ok: true, kind, path: dest };
  }

  if (kind === 'appimage' && process.platform === 'linux') {
    try { fs.chmodSync(dest, 0o755); } catch (_) {}
    scheduleLinuxAppImageReplace(dest);
    setTimeout(() => app.quit(), 600);
    return { ok: true, kind, path: dest };
  }

  if (kind === 'maczip' && process.platform === 'darwin') {
    scheduleMacZipReplace(dest);
    setTimeout(() => app.quit(), 600);
    return { ok: true, kind, path: dest };
  }

  // Fallback: open the downloaded file and quit
  try {
    if (process.platform === 'linux') {
      spawn('xdg-open', [dest], { detached: true, stdio: 'ignore' }).unref();
    } else {
      await shell.openPath(dest);
    }
  } catch (_) {
    shell.showItemInFolder(dest);
  }
  setTimeout(() => app.quit(), 800);
  return { ok: true, kind: 'fallback', path: dest };
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => globalShortcut.unregisterAll());
