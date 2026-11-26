const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('opentuneLyricsOverlay', {
  sendCommand(action, value) {
    ipcRenderer.send('ytm:shell-player', { action, value });
  },
  closeOverlay() {
    ipcRenderer.send('ytm:shell-set-desktop-lyrics', false);
  },
  requestState() {
    ipcRenderer.send('ytm:lyrics-overlay-ready');
  },
  onTrackState(callback) {
    if (typeof callback !== 'function') return;
    ipcRenderer.on('ytm:track-state', (_event, payload) => callback(payload));
  },
  onLyricsState(callback) {
    if (typeof callback !== 'function') return;
    ipcRenderer.on('ytm:lyrics-state', (_event, payload) => callback(payload));
  },
});
