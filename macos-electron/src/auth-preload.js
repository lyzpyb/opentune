const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ytmAuthBridge', {
  startExternalBrowser() {
    return ipcRenderer.invoke('ytm:auth-start-external');
  },
  openDefaultBrowser() {
    ipcRenderer.send('ytm:auth-open-default');
  },
  importCookie(raw) {
    return ipcRenderer.invoke('ytm:auth-import-cookie', raw);
  },
  cancel() {
    ipcRenderer.send('ytm:auth-cancel');
  },
  onStatus(listener) {
    ipcRenderer.on('ytm:auth-status', (_event, payload) => listener(payload));
  },
});
