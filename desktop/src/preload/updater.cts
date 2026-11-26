// Preload of the updater window (src/main/updaterWindow.ts, assets/updater.html).
// A sandboxed preload must be CommonJS and self-contained.
const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');

contextBridge.exposeInMainWorld('overcordUpdater', Object.freeze({
  onRender: (callback: (view: unknown) => void) => {
    ipcRenderer.on('overcord:updater:render', (_event, view: unknown) => callback(view));
  },
  act: (action: string) => ipcRenderer.send('overcord:updater:action', String(action)),
}));
