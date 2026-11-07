/**
 * Auto-update checker for Rift Horizon (Electron Windows/macOS/Linux + Capacitor APK).
 * Web / GitHub Pages is always live — never prompts or locks multiplayer.
 *
 * - Local version: version.txt stamped by CI
 * - Remote: GitHub Releases /latest
 * - Update: Electron download+relaunch; Android package-installer intent
 * - Cancel: locks multiplayer until the installed version catches up (native only)
 */
const REPO = 'TheFallenStarGG/Rift-Horizon';
const API_LATEST = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;
const CACHE_KEY = 'rift.update.cache.v1';
const OFFLINE_KEY = 'rift.forceOfflineUntil';
const CACHE_MS = 30 * 60 * 1000;

function parseVer(s) {
  return String(s || '')
    .trim()
    .replace(/^v/i, '')
    .split(/[^\d]+/)
    .filter(Boolean)
    .map((n) => parseInt(n, 10) || 0);
}

/** true if a is strictly newer than b */
export function isNewer(a, b) {
  const A = parseVer(a);
  const B = parseVer(b);
  const n = Math.max(A.length, B.length);
  for (let i = 0; i < n; i++) {
    const x = A[i] || 0;
    const y = B[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

export function detectPlatform() {
  try {
    if (window.riftDesktop && typeof window.riftDesktop.downloadUpdate === 'function') {
      return 'electron';
    }
  } catch (_) {}
  // Real native Capacitor only — normal mobile browsers stay 'web'
  try {
    const Cap = window.Capacitor;
    if (Cap && typeof Cap.isNativePlatform === 'function' && Cap.isNativePlatform()) {
      const p = (Cap.getPlatform && Cap.getPlatform()) || '';
      if (p === 'android') return 'android';
      if (p === 'ios') return 'ios';
      return 'native';
    }
  } catch (_) {}
  try {
    if (
      typeof window.__riftInstallApk === 'function' ||
      (window.Android && window.Android.installApkBase64)
    ) {
      return 'android';
    }
  } catch (_) {}
  return 'web';
}

/** Browser / GitHub Pages — always live, never update-prompt or offline-lock */
export function isWebClient() {
  const p = detectPlatform();
  return p === 'web' || p === 'ios';
}

async function readLocalVersion() {
  try {
    const r = await fetch(new URL('../version.txt', import.meta.url).href, { cache: 'no-store' });
    if (r.ok) {
      const t = (await r.text()).trim();
      if (t) return t.replace(/^v/i, '');
    }
  } catch (_) {}
  try {
    const r = await fetch('version.txt', { cache: 'no-store' });
    if (r.ok) {
      const t = (await r.text()).trim();
      if (t) return t.replace(/^v/i, '');
    }
  } catch (_) {}
  return '0.0.0';
}

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o || !o.at || Date.now() - o.at > CACHE_MS) return null;
    return o;
  } catch (_) {
    return null;
  }
}

function saveCache(info) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), info }));
  } catch (_) {}
}

export function getOfflineLock() {
  try {
    return localStorage.getItem(OFFLINE_KEY) || '';
  } catch (_) {
    return '';
  }
}

export function setOfflineLock(version) {
  try {
    if (version) localStorage.setItem(OFFLINE_KEY, String(version).replace(/^v/i, ''));
    else localStorage.removeItem(OFFLINE_KEY);
  } catch (_) {}
}

/** true when multiplayer must stay disabled until user updates (native only) */
export function isForcedOffline(localVersion) {
  if (isWebClient()) return false;
  const until = getOfflineLock();
  if (!until) return false;
  return isNewer(until, localVersion || '0.0.0');
}

/**
 * Prefer the right release asset for this client.
 * Electron: uses window.riftDesktop.getPlatform() when available (cached on info.os).
 * Asset naming (CI):
 *   …-Windows-Portable-x64.exe / …-Windows-Setup-Installer-x64.exe
 *   …-macOS-x64.zip / …-macOS-arm64.zip
 *   …-Linux-x64.AppImage / …-Linux-x64.deb
 *   …-android.apk
 */
function pickAsset(assets, platform, osInfo) {
  if (!Array.isArray(assets)) return null;
  const name = (a) => (a && a.name ? String(a.name).toLowerCase() : '');
  if (platform === 'android') {
    return (
      assets.find((a) => name(a).endsWith('.apk') && name(a).includes('android')) ||
      assets.find((a) => name(a).endsWith('.apk')) ||
      null
    );
  }
  if (platform === 'electron') {
    const osPlat = (osInfo && osInfo.platform) || '';
    const arch = (osInfo && osInfo.arch) || '';
    if (osPlat === 'darwin') {
      const archTag = arch === 'arm64' ? 'arm64' : 'x64';
      return (
        assets.find((a) => name(a).includes('macos') && name(a).includes(archTag) && name(a).endsWith('.zip')) ||
        assets.find((a) => name(a).includes('macos') && name(a).endsWith('.zip')) ||
        assets.find((a) => name(a).includes('darwin') && name(a).endsWith('.zip')) ||
        assets.find((a) => name(a).endsWith('.dmg') && name(a).includes(archTag)) ||
        assets.find((a) => name(a).endsWith('.dmg')) ||
        null
      );
    }
    if (osPlat === 'linux') {
      return (
        assets.find((a) => name(a).includes('linux') && name(a).endsWith('.appimage')) ||
        assets.find((a) => name(a).endsWith('.appimage')) ||
        assets.find((a) => name(a).includes('linux') && name(a).endsWith('.deb')) ||
        assets.find((a) => name(a).endsWith('.deb')) ||
        null
      );
    }
    // win32 / default — portable preferred over setup installer
    return (
      assets.find((a) => name(a).includes('portable') && name(a).endsWith('.exe')) ||
      assets.find((a) => name(a).includes('windows') && name(a).endsWith('.exe') && !name(a).includes('setup')) ||
      assets.find((a) => name(a).endsWith('.exe') && !name(a).includes('setup')) ||
      assets.find((a) => name(a).endsWith('.exe')) ||
      null
    );
  }
  return null;
}

/** Map a chosen asset filename → electron update kind */
function kindFromAsset(assetName, osPlat) {
  const n = String(assetName || '').toLowerCase();
  if (n.endsWith('.appimage')) return 'appimage';
  if (n.endsWith('.deb')) return 'deb';
  if (n.endsWith('.zip') || n.endsWith('.dmg')) return 'maczip';
  if (n.includes('setup') || n.includes('installer')) return 'setup';
  if (n.endsWith('.exe')) return 'portable';
  if (osPlat === 'darwin') return 'maczip';
  if (osPlat === 'linux') return 'appimage';
  return 'portable';
}

/**
 * @returns {Promise<null|{local:string,remote:string,tag:string,notes:string,asset:object|null,url:string,platform:string}>}
 */
export async function checkForUpdate({ force = false } = {}) {
  if (isWebClient()) return null;

  const local = await readLocalVersion();
  if (!force) {
    const c = loadCache();
    if (c && c.info) {
      if (isNewer(c.info.remote, local)) {
        return { ...c.info, local, platform: detectPlatform() };
      }
      return null;
    }
  }

  const r = await fetch(API_LATEST, {
    headers: { Accept: 'application/vnd.github+json' },
    cache: 'no-store',
  });
  if (!r.ok) throw new Error(`GitHub API ${r.status}`);
  const data = await r.json();
  const tag = String(data.tag_name || data.name || '').trim();
  const remote = tag.replace(/^v/i, '');
  if (!remote || !isNewer(remote, local)) {
    saveCache({ remote, tag, notes: '', asset: null, url: RELEASES_PAGE });
    return null;
  }

  const platform = detectPlatform();
  let osInfo = null;
  if (platform === 'electron' && window.riftDesktop && typeof window.riftDesktop.getPlatform === 'function') {
    try { osInfo = await window.riftDesktop.getPlatform(); } catch (_) {}
  }
  const asset = pickAsset(data.assets || [], platform, osInfo);
  const info = {
    local,
    remote,
    tag,
    notes: String(data.body || '').slice(0, 800),
    asset: asset
      ? {
          name: asset.name,
          size: asset.size,
          url: asset.browser_download_url,
          kind: kindFromAsset(asset.name, osInfo && osInfo.platform),
        }
      : null,
    url: data.html_url || RELEASES_PAGE,
    platform,
    os: osInfo,
  };
  saveCache(info);
  return info;
}

function injectStyles() {
  if (document.getElementById('riftUpdCss')) return;
  const s = document.createElement('style');
  s.id = 'riftUpdCss';
  s.textContent = `
#riftUpdOverlay{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;
  background:rgba(0,0,0,.72);backdrop-filter:blur(6px);font-family:system-ui,Segoe UI,Roboto,sans-serif}
#riftUpdCard{width:min(420px,92vw);background:#12151c;border:1px solid #3a2f12;border-radius:14px;
  box-shadow:0 0 0 1px #000,0 20px 60px rgba(0,0,0,.55);padding:22px 22px 18px;color:#e8e6df}
#riftUpdCard h2{margin:0 0 6px;font-size:15px;letter-spacing:.14em;color:#f0c14b;font-weight:700}
#riftUpdCard .ver{font-size:22px;font-weight:800;margin:10px 0 8px;color:#fff}
#riftUpdCard .ver span{color:#f0c14b}
#riftUpdCard .notes{font-size:12px;line-height:1.45;color:#9a9688;max-height:110px;overflow:auto;
  white-space:pre-wrap;margin:0 0 14px;border-left:2px solid #3a2f12;padding-left:10px}
#riftUpdCard .row{display:flex;gap:10px}
#riftUpdCard button{flex:1;border:0;border-radius:10px;padding:12px 14px;font-weight:700;font-size:14px;
  letter-spacing:.06em;cursor:pointer}
#riftUpdCard .go{background:linear-gradient(180deg,#f5d56a,#d4a017);color:#1a1400;
  box-shadow:0 0 18px rgba(240,193,75,.35)}
#riftUpdCard .go:disabled{opacity:.5;cursor:wait}
#riftUpdCard .no{background:#1c212b;color:#c8c4b8;border:1px solid #2c3340}
#riftUpdCard .bar{height:6px;background:#1c212b;border-radius:4px;overflow:hidden;margin:12px 0 6px;display:none}
#riftUpdCard .bar>i{display:block;height:100%;width:0;background:#f0c14b;transition:width .15s linear}
#riftUpdCard .status{font-size:12px;color:#9a9688;min-height:16px}
#riftOfflineBanner{position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:99990;
  background:rgba(40,18,8,.92);border:1px solid #8a4a12;color:#f0c14b;padding:8px 14px;border-radius:10px;
  font:600 13px/1.3 system-ui,sans-serif;display:none;align-items:center;gap:10px;max-width:92vw}
#riftOfflineBanner.on{display:flex}
#riftOfflineBanner button{border:1px solid #f0c14b;background:transparent;color:#f0c14b;border-radius:6px;
  padding:4px 10px;font-weight:700;cursor:pointer}
`;
  document.head.appendChild(s);
}

function ensureOfflineBanner() {
  injectStyles();
  let el = document.getElementById('riftOfflineBanner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'riftOfflineBanner';
    el.innerHTML =
      'Offline mode — update required for multiplayer <button type="button" data-upd>UPDATE</button>';
    document.body.appendChild(el);
  }
  return el;
}

export function refreshOfflineBanner(localVersion, pendingInfo) {
  const el = ensureOfflineBanner();
  if (isWebClient()) {
    setOfflineLock('');
    el.classList.remove('on');
    return false;
  }
  const forced = isForcedOffline(localVersion);
  el.classList.toggle('on', forced);
  const btn = el.querySelector('[data-upd]');
  if (btn) {
    btn.onclick = async () => {
      const info = pendingInfo || (await checkForUpdate({ force: true }));
      if (info) await showUpdateModal(info);
    };
  }
  return forced;
}

/**
 * @param {object} info from checkForUpdate
 * @returns {Promise<'updated'|'offline'|'dismissed'>}
 */
export function showUpdateModal(info) {
  if (isWebClient()) return Promise.resolve('dismissed');
  injectStyles();
  return new Promise((resolve) => {
    const prev = document.getElementById('riftUpdOverlay');
    if (prev) prev.remove();

    const ov = document.createElement('div');
    ov.id = 'riftUpdOverlay';
    const notes =
      (info.notes &&
        info.notes
          .split('\n')
          .filter((l) => l.trim())
          .slice(0, 6)
          .join('\n')) ||
      'A newer build is available on GitHub Releases.';

    ov.innerHTML = `
      <div id="riftUpdCard" role="dialog" aria-modal="true">
        <h2>⚡ UPDATE AVAILABLE</h2>
        <div class="ver">v${info.local} → <span>v${info.remote}</span></div>
        <div class="notes">${notes.replace(/</g, '&lt;')}</div>
        <div class="bar"><i></i></div>
        <div class="status"></div>
        <div class="row">
          <button type="button" class="go" data-up>UPDATE</button>
          <button type="button" class="no" data-no>PLAY OFFLINE</button>
        </div>
      </div>`;
    document.body.appendChild(ov);

    const fill = ov.querySelector('.bar > i');
    const bar = ov.querySelector('.bar');
    const statusEl = ov.querySelector('.status');
    const btnUp = ov.querySelector('[data-up]');
    const btnCancel = ov.querySelector('[data-no]');

    const done = (result) => {
      ov.remove();
      resolve(result);
    };

    btnCancel.onclick = () => {
      setOfflineLock(info.remote);
      refreshOfflineBanner(info.local, info);
      done('offline');
    };

    btnUp.onclick = async () => {
      btnUp.disabled = true;
      btnCancel.disabled = true;
      bar.style.display = 'block';
      statusEl.textContent = 'Starting download…';
      try {
        await applyUpdate(info, {
          onProgress: (p) => {
            fill.style.width = Math.round(p * 100) + '%';
          },
          onStatus: (s) => {
            statusEl.textContent = s;
          },
        });
        if ((info.platform || detectPlatform()) === 'android') {
          statusEl.textContent = 'Confirm the install when prompted, then relaunch the app.';
          btnCancel.disabled = false;
          btnCancel.textContent = 'Close';
          btnCancel.onclick = () => {
            setOfflineLock(info.remote);
            refreshOfflineBanner(info.local, info);
            done('updated');
          };
        } else {
          done('updated');
        }
      } catch (e) {
        statusEl.textContent = (e && e.message) || 'Update failed';
        btnUp.disabled = false;
        btnCancel.disabled = false;
        btnCancel.textContent = 'Play offline';
      }
    };
  });
}

async function blobToBase64(blob) {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Platform-specific install path.
 * @param {object} info
 * @param {{onProgress?:(n:number)=>void,onStatus?:(s:string)=>void}} cbs
 */
export async function applyUpdate(info, cbs = {}) {
  const platform = info.platform || detectPlatform();
  const onProgress = cbs.onProgress || (() => {});
  const onStatus = cbs.onStatus || (() => {});

  if (platform === 'electron' && window.riftDesktop && window.riftDesktop.downloadUpdate) {
    if (!info.asset || !info.asset.url) {
      onStatus('Opening releases page…');
      window.open(info.url || RELEASES_PAGE, '_blank');
      throw new Error('No matching desktop build on this release for your OS');
    }
    onStatus('Downloading update…');
    const url = info.asset.url;
    let osInfo = info.os;
    if (!osInfo && typeof window.riftDesktop.getPlatform === 'function') {
      try { osInfo = await window.riftDesktop.getPlatform(); } catch (_) {}
    }
    const kind =
      info.asset.kind ||
      kindFromAsset(info.asset.name, osInfo && osInfo.platform);
    await window.riftDesktop.downloadUpdate({
      url,
      version: info.remote,
      kind,
      onProgress,
    });
    onProgress(1);
    onStatus('Installing / relaunching…');
    return;
  }

  if (platform === 'android') {
    if (!info.asset || !info.asset.url) {
      throw new Error('No APK asset on this release');
    }
    onStatus('Downloading APK…');
    const res = await fetch(info.asset.url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    const total = Number(res.headers.get('content-length')) || (info.asset.size || 0);
    const reader = res.body && res.body.getReader ? res.body.getReader() : null;
    let received = 0;
    let chunks = [];
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.byteLength;
        if (total) onProgress(Math.min(0.99, received / total));
        else onProgress(0.5);
      }
    } else {
      const buf = await res.arrayBuffer();
      chunks = [new Uint8Array(buf)];
      received = buf.byteLength;
      onProgress(0.99);
    }
    const blob = new Blob(chunks, { type: 'application/vnd.android.package-archive' });
    onStatus('Preparing installer…');
    const b64 = await blobToBase64(blob);
    onProgress(1);

    let ok = false;
    if (typeof window.__riftInstallApk === 'function') {
      ok = !!window.__riftInstallApk(b64, info.asset.name || 'rift-update.apk');
    } else if (window.Android && window.Android.installApkBase64) {
      ok = !!window.Android.installApkBase64(b64, info.asset.name || 'rift-update.apk');
    }
    if (!ok) {
      // Fallback: open download URL so user can install manually
      onStatus('Opening download…');
      window.open(info.asset.url, '_blank');
      throw new Error('Could not launch package installer — opened download instead');
    }
    onStatus('Install prompt opened');
    return;
  }

  // Fallback
  window.open(info.url || RELEASES_PAGE, '_blank');
}

/**
 * Boot-time entry. No-op on web.
 * @param {{onLockChange?:(forced:boolean)=>void}} opts
 */
export async function initUpdater(opts = {}) {
  if (isWebClient()) {
    setOfflineLock('');
    try {
      const b = document.getElementById('riftOfflineBanner');
      if (b) b.classList.remove('on');
    } catch (_) {}
    return {
      local: 'web',
      forcedOffline: () => false,
      recheck: async () => null,
    };
  }

  const local = await readLocalVersion();
  const until = getOfflineLock();
  if (until && !isNewer(until, local)) setOfflineLock('');

  let info = null;
  try {
    info = await checkForUpdate();
  } catch (_) {}

  if (info) {
    setTimeout(async () => {
      await showUpdateModal(info);
      const forced = refreshOfflineBanner(local, info);
      if (opts.onLockChange) opts.onLockChange(forced);
    }, 600);
  } else {
    const forced = refreshOfflineBanner(local, null);
    if (opts.onLockChange) opts.onLockChange(forced);
  }

  return {
    local,
    forcedOffline: () => isForcedOffline(local),
    recheck: async () => {
      if (isWebClient()) return null;
      const i = await checkForUpdate({ force: true });
      if (i) await showUpdateModal(i);
      const f = refreshOfflineBanner(await readLocalVersion(), i);
      if (opts.onLockChange) opts.onLockChange(f);
      return i;
    },
  };
}
