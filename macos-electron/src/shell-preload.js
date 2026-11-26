const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('opentuneShell', {
  navigate(action, value) {
    ipcRenderer.send('ytm:shell-nav', { action, value });
  },
  playerCommand(action, value) {
    ipcRenderer.send('ytm:shell-player', { action, value });
  },
  openAuth() {
    ipcRenderer.send('ytm:shell-open-auth');
  },
  setMediaKeysEnabled(enabled) {
    ipcRenderer.send('ytm:shell-set-media-keys', Boolean(enabled));
  },
  setDesktopLyricsEnabled(enabled) {
    ipcRenderer.send('ytm:shell-set-desktop-lyrics', Boolean(enabled));
  },
  setImmersiveOpen(open) {
    ipcRenderer.send('ytm:shell-set-immersive', Boolean(open));
  },
  requestInitialState() {
    ipcRenderer.send('ytm:shell-ready');
  },
  onTrackState(callback) {
    if (typeof callback !== 'function') return;
    ipcRenderer.on('ytm:track-state', (_event, payload) => callback(payload));
  },
  onNavState(callback) {
    if (typeof callback !== 'function') return;
    ipcRenderer.on('ytm:nav-state', (_event, payload) => callback(payload));
  },
  onSettingsState(callback) {
    if (typeof callback !== 'function') return;
    ipcRenderer.on('ytm:settings-state', (_event, payload) => callback(payload));
  },
  onLyricsState(callback) {
    if (typeof callback !== 'function') return;
    ipcRenderer.on('ytm:lyrics-state', (_event, payload) => callback(payload));
  },
});
