/**
 * Preload bridge: exposes a safe update API to the game renderer.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('riftDesktop', {
  platform: 'electron',
  getVersion: () => ipcRenderer.invoke('rift:get-version'),
  getPlatform: () => ipcRenderer.invoke('rift:get-platform'),
  downloadUpdate: (opts) => {
    // opts: { url, version, kind: 'portable'|'setup'|'appimage'|'deb'|'maczip', onProgress? }
    return new Promise((resolve, reject) => {
      const onProg = (_e, p) => {
        try {
          if (opts && typeof opts.onProgress === 'function') opts.onProgress(p);
        } catch (_) {}
      };
      ipcRenderer.on('rift:update-progress', onProg);
      ipcRenderer
        .invoke('rift:download-update', {
          url: opts.url,
          version: opts.version,
          kind: opts.kind || 'portable',
        })
        .then((r) => {
          ipcRenderer.removeListener('rift:update-progress', onProg);
          resolve(r);
        })
        .catch((err) => {
          ipcRenderer.removeListener('rift:update-progress', onProg);
          reject(err);
        });
    });
  },
});
