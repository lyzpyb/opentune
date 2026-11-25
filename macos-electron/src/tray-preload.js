const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ytmTrayBridge', {
  onState(callback) {
    ipcRenderer.on('ytm:tray-state', (_event, state) => callback(state));
  },
  sendCommand(action, value) {
    ipcRenderer.send('ytm:tray-command', { action, value });
  },
});
