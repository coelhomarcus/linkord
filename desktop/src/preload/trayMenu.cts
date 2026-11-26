// Preload of the drawn tray menu (src/main/trayMenuWindow.ts, assets/tray-menu.html).
// A sandboxed preload must be CommonJS and self-contained.
const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');

contextBridge.exposeInMainWorld('overcordTrayMenu', Object.freeze({
  onRender: (callback: (model: unknown) => void) => {
    ipcRenderer.on('overcord:tray-menu:render', (_event, model: unknown) => callback(model));
  },
  choose: (id: string, checked?: boolean) => ipcRenderer.send('overcord:tray-menu:choose', String(id), checked === true),
  close: () => ipcRenderer.send('overcord:tray-menu:close'),
}));
