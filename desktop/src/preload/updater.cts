// Preload of the updater window (src/main/updaterWindow.ts, assets/updater.html).
// A sandboxed preload must be CommonJS and self-contained.
const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');

contextBridge.exposeInMainWorld('linkordUpdater', Object.freeze({
  onRender: (callback: (view: unknown) => void) => {
    ipcRenderer.on('linkord:updater:render', (_event, view: unknown) => callback(view));
  },
  act: (action: string) => ipcRenderer.send('linkord:updater:action', String(action)),
}));
