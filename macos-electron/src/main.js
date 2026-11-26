const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  WebContentsView,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  nativeImage,
  nativeTheme,
  powerSaveBlocker,
  screen,
  session,
  shell,
} = require('electron');
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');
const net = require('net');
const os = require('os');
const path = require('path');

// Prevent Chromium/macOS from throttling background audio timers or blocking autoplay across track transitions
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

const APP_NAME = "OpenTune";
const START_URL = "https://music.youtube.com";
const GOOGLE_LOGIN_URL = 'https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fmusic.youtube.com%2F';
const PARTITION_NAME = 'persist:ytmusic';
const SANITIZE_UA = true;
const ENABLE_MEDIA_KEYS = true;
const CLOSE_TO_TRAY = true;
const HIDDEN_TITLEBAR = true;
const PROXY_SERVER = "";
const MEDIA_SHORTCUTS = ['MediaPlayPause', 'MediaNextTrack', 'MediaPreviousTrack'];
const SIDEBAR_WIDTH = 228;
const TOPBAR_HEIGHT = 54;
const PLAYER_HEIGHT = 82;

const CHROME_VERSION = process.versions.chrome || '130.0.0.0';
const CHROME_MAC_UA = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_VERSION} Safari/537.36`;

let mainWindow = null;
let musicView = null;
let tray = null;
let trayWindow = null;
let lyricsWindow = null;
let authWindow = null;
let isQuitting = false;
let powerBlockerId = null;
let mediaKeysEnabled = ENABLE_MEDIA_KEYS;
let desktopLyricsEnabled = false;
let isImmersiveOpen = false;
const lyricsCache = new Map();
let currentLyrics = {
  key: '',
  status: 'idle',
  synced: [],
  plain: '',
};
let accountState = {
  loggedIn: false,
  name: '',
  avatar: '',
};

function broadcastAccountState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('ytm:account-state', accountState);
  }
}

async function refreshAccountFromCookies() {
  try {
    const ses = session.fromPartition(PARTITION_NAME);
    const cookies = await ses.cookies.get({ domain: 'youtube.com' });
    const authNames = new Set(['SAPISID', '__Secure-3PAPISID', 'SID', '__Secure-3PSID', 'LOGIN_INFO']);
    const hasAuth = cookies.some((c) => c && authNames.has(c.name));
    if (hasAuth && !accountState.loggedIn) {
      accountState = { loggedIn: true, name: accountState.name || 'Google 账号已登录', avatar: accountState.avatar || '' };
      broadcastAccountState();
    } else if (!hasAuth && accountState.loggedIn) {
      accountState = { loggedIn: false, name: '', avatar: '' };
      broadcastAccountState();
    }
  } catch (_) {}
}

async function logoutAccount() {
  const ses = session.fromPartition(PARTITION_NAME);
  await ses.clearStorageData({ storages: ['cookies', 'localstorage'] });
  accountState = { loggedIn: false, name: '', avatar: '' };
  broadcastAccountState();
  navigateHome();
}

function getMusicWebContents() {
  if (!musicView || !musicView.webContents || musicView.webContents.isDestroyed()) return null;
  return musicView.webContents;
}

function layoutMusicView() {
  if (!mainWindow || mainWindow.isDestroyed() || !musicView) return;
  const [contentWidth, contentHeight] = mainWindow.getContentSize();
  musicView.setBounds({
    x: SIDEBAR_WIDTH,
    y: TOPBAR_HEIGHT,
    width: Math.max(0, contentWidth - SIDEBAR_WIDTH),
    height: Math.max(0, contentHeight - TOPBAR_HEIGHT - PLAYER_HEIGHT),
  });
}

function getSettingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings() {
  try {
    const filePath = getSettingsPath();
    if (!fs.existsSync(filePath)) return;
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (typeof parsed.enableMediaKeys === 'boolean') {
      mediaKeysEnabled = parsed.enableMediaKeys;
    }
    if (typeof parsed.desktopLyricsEnabled === 'boolean') {
      desktopLyricsEnabled = parsed.desktopLyricsEnabled;
    }
  } catch (_) {}
}

function saveSettings(partial) {
  try {
    const filePath = getSettingsPath();
    let current = {};
    if (fs.existsSync(filePath)) {
      try {
        current = JSON.parse(fs.readFileSync(filePath, 'utf-8')) || {};
      } catch (_) {
        current = {};
      }
    }
    const merged = { ...current, ...partial };
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(merged, null, 2), 'utf-8');
  } catch (_) {}
}

function broadcastSettings() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('ytm:settings-state', {
      enableMediaKeys: mediaKeysEnabled,
      desktopLyricsEnabled,
      immersiveOpen: isImmersiveOpen,
    });
  }
}

function broadcastLyricsState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('ytm:lyrics-state', currentLyrics);
  }
  if (lyricsWindow && !lyricsWindow.isDestroyed()) {
    lyricsWindow.webContents.send('ytm:lyrics-state', currentLyrics);
  }
}

function setMediaKeysEnabled(enabled) {
  mediaKeysEnabled = Boolean(enabled);
  saveSettings({ enableMediaKeys: mediaKeysEnabled });
  applyMediaShortcuts(mediaKeysEnabled);
  setupAppMenu();
  broadcastSettings();
}

function setImmersiveOpen(open) {
  isImmersiveOpen = Boolean(open);
  if (musicView) {
    musicView.setVisible(!isImmersiveOpen);
  }
  broadcastSettings();
  if (isImmersiveOpen) {
    broadcastLyricsState();
  }
}

function createLyricsWindow() {
  if (lyricsWindow && !lyricsWindow.isDestroyed()) {
    lyricsWindow.showInactive();
    return lyricsWindow;
  }
  const display = screen.getPrimaryDisplay();
  const workArea = display.workArea;
  const width = Math.min(760, Math.max(480, Math.round(workArea.width * 0.52)));
  const height = 84;
  const x = Math.round(workArea.x + (workArea.width - width) / 2);
  const y = Math.round(workArea.y + workArea.height - height - 28);

  lyricsWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    frame: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'lyrics-overlay-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  lyricsWindow.setAlwaysOnTop(true, 'floating');
  if (process.platform === 'darwin') {
    lyricsWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
  lyricsWindow.loadFile(path.join(__dirname, 'lyrics-overlay.html'));
  lyricsWindow.webContents.on('did-finish-load', () => {
    broadcastTrackToTray();
    broadcastLyricsState();
  });
  lyricsWindow.on('closed', () => {
    lyricsWindow = null;
  });
  return lyricsWindow;
}

function setDesktopLyricsEnabled(enabled) {
  desktopLyricsEnabled = Boolean(enabled);
  saveSettings({ desktopLyricsEnabled });
  if (desktopLyricsEnabled) {
    createLyricsWindow();
  } else if (lyricsWindow && !lyricsWindow.isDestroyed()) {
    lyricsWindow.close();
    lyricsWindow = null;
  }
  setupAppMenu();
  broadcastSettings();
}

function httpsGetJson(rawUrl) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      rawUrl,
      {
        headers: {
          'User-Agent': `${APP_NAME}/1.1.0 (https://github.com/lyzpyb/opentune)`,
          Accept: 'application/json',
        },
        timeout: 6000,
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

function normalizeArtistName(rawArtist) {
  const str = String(rawArtist || '').trim();
  if (!str) return '';
  return str.split(/[•·—|]/)[0].trim();
}

function parseLrc(lrcText) {
  if (!lrcText || typeof lrcText !== 'string') return [];
  const lines = [];
  const regex = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;
  for (const rawLine of lrcText.split(/\r?\n/)) {
    const timestamps = [];
    let match;
    regex.lastIndex = 0;
    while ((match = regex.exec(rawLine)) !== null) {
      const mins = Number(match[1]) || 0;
      const secs = Number(match[2]) || 0;
      const fracStr = match[3] || '0';
      const frac = Number(fracStr) / Math.pow(10, fracStr.length);
      timestamps.push(mins * 60 + secs + frac);
    }
    const text = rawLine.replace(regex, '').trim();
    if (!text || timestamps.length === 0) continue;
    for (const time of timestamps) {
      lines.push({ time, text });
    }
  }
  lines.sort((a, b) => a.time - b.time);
  return lines;
}

async function fetchLyricsForTrack(title, artist, duration) {
  const cleanTitle = String(title || '').trim();
  const cleanArtist = normalizeArtistName(artist);
  if (!cleanTitle || cleanTitle === '未在播放') {
    currentLyrics = { key: '', status: 'idle', synced: [], plain: '' };
    broadcastLyricsState();
    return;
  }

  const key = `${cleanTitle}|${cleanArtist}`;
  if (currentLyrics.key === key && currentLyrics.status !== 'idle') return;

  if (lyricsCache.has(key)) {
    currentLyrics = lyricsCache.get(key);
    broadcastLyricsState();
    return;
  }

  currentLyrics = { key, status: 'loading', synced: [], plain: '' };
  broadcastLyricsState();

  try {
    const params = new URLSearchParams({ track_name: cleanTitle });
    if (cleanArtist) params.set('artist_name', cleanArtist);
    if (Number.isFinite(duration) && duration > 0) params.set('duration', String(Math.round(duration)));

    let data = null;
    try {
      data = await httpsGetJson(`https://lrclib.net/api/get?${params.toString()}`);
    } catch (_) {
      const q = cleanArtist ? `${cleanTitle} ${cleanArtist}` : cleanTitle;
      const list = await httpsGetJson(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`);
      if (Array.isArray(list) && list.length > 0) {
        data = list.find((item) => item && item.syncedLyrics) || list[0];
      }
    }

    const synced = parseLrc(data?.syncedLyrics || '');
    const plain = typeof data?.plainLyrics === 'string' ? data.plainLyrics.trim() : '';
    const result = {
      key,
      status: synced.length > 0 || plain ? 'ready' : 'not-found',
      synced,
      plain,
    };
    lyricsCache.set(key, result);
    if (currentLyrics.key === key) {
      currentLyrics = result;
      broadcastLyricsState();
    }
  } catch (_) {
    const fallback = { key, status: 'not-found', synced: [], plain: '' };
    lyricsCache.set(key, fallback);
    if (currentLyrics.key === key) {
      currentLyrics = fallback;
      broadcastLyricsState();
    }
  }
}

let activeAuthSession = null;

let currentTrack = {
  title: '未在播放',
  artist: APP_NAME,
  artwork: '',
  playing: false,
  currentTime: 0,
  duration: 0,
  volume: 100,
  muted: false,
  liked: false,
};

function isGoogleAuthUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    return (
      host === 'accounts.google.com' ||
      host === 'accounts.youtube.com' ||
      host === 'gds.google.com' ||
      host === 'myaccount.google.com' ||
      host === 'consent.youtube.com' ||
      host === 'consent.google.com' ||
      (host === 'www.youtube.com' && parsed.pathname.startsWith('/signin')) ||
      (host.endsWith('.google.com') && parsed.pathname.includes('/o/oauth2'))
    );
  } catch (_) {
    return false;
  }
}

function isAllowedInAppUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    const host = parsed.hostname.toLowerCase();
    return host === 'music.youtube.com';
  } catch (_) {
    return false;
  }
}

function updatePowerSaveBlocker(isPlaying) {
  if (isPlaying) {
    if (powerBlockerId === null || !powerSaveBlocker.isStarted(powerBlockerId)) {
      powerBlockerId = powerSaveBlocker.start('prevent-app-suspension');
    }
  } else if (powerBlockerId !== null && powerSaveBlocker.isStarted(powerBlockerId)) {
    powerSaveBlocker.stop(powerBlockerId);
    powerBlockerId = null;
  }
}

function detectActiveRoute(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    const pathname = parsed.pathname || '/';
    const listParam = parsed.searchParams.get('list');
    if (pathname === '/' || pathname === '') return 'home';
    if (pathname.startsWith('/explore')) return 'explore';
    if (pathname.startsWith('/library')) return 'library';
    if (pathname.startsWith('/history')) return 'history';
    if (pathname.startsWith('/playlist') && listParam === 'LM') return 'liked';
    return '';
  } catch (_) {
    return '';
  }
}

function broadcastNavState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const wc = getMusicWebContents();
  if (!wc) return;
  const currentUrl = wc.getURL() || START_URL;
  let onMusicHome = true;
  try {
    onMusicHome = new URL(currentUrl).hostname.toLowerCase() === 'music.youtube.com';
  } catch (_) {}
  mainWindow.webContents.send('ytm:nav-state', {
    canGoBack: wc.navigationHistory ? wc.navigationHistory.canGoBack() : wc.canGoBack(),
    canGoForward: wc.navigationHistory ? wc.navigationHistory.canGoForward() : wc.canGoForward(),
    url: currentUrl,
    onMusicHome,
    activeRoute: detectActiveRoute(currentUrl),
    hiddenTitlebar: HIDDEN_TITLEBAR,
  });
}

function broadcastTrackToTray() {
  if (tray) {
    tray.setToolTip(`${APP_NAME} — ${currentTrack.title}`);
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('ytm:track-state', currentTrack);
  }
  if (trayWindow && !trayWindow.isDestroyed()) {
    trayWindow.webContents.send('ytm:tray-state', currentTrack);
  }
  if (lyricsWindow && !lyricsWindow.isDestroyed()) {
    lyricsWindow.webContents.send('ytm:track-state', currentTrack);
  }
}

function sendAuthStatus(payload) {
  if (authWindow && !authWindow.isDestroyed()) {
    authWindow.webContents.send('ytm:auth-status', payload);
  }
}

function findInstalledChromiumBrowser() {
  const home = os.homedir();
  const candidates =
    process.platform === 'darwin'
      ? [
          { name: 'Google Chrome', path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
          { name: 'Google Chrome', path: path.join(home, 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome') },
          { name: 'Microsoft Edge', path: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge' },
          { name: 'Brave Browser', path: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser' },
          { name: 'Vivaldi', path: '/Applications/Vivaldi.app/Contents/MacOS/Vivaldi' },
          { name: 'Chromium', path: '/Applications/Chromium.app/Contents/MacOS/Chromium' },
          { name: 'Chrome Canary', path: '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary' },
        ]
      : [
          { name: 'Google Chrome', path: '/usr/bin/google-chrome' },
          { name: 'Chromium', path: '/usr/bin/chromium' },
          { name: 'Microsoft Edge', path: '/usr/bin/microsoft-edge' },
        ];

  for (const item of candidates) {
    try {
      if (fs.existsSync(item.path)) return item;
    } catch (_) {}
  }
  return null;
}

function getFreeLocalPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function httpGetLocalJson(port, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: urlPath, timeout: 2500 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('timeout', () => {
      req.destroy(new Error('timeout'));
    });
    req.on('error', reject);
  });
}

function cdpSendCommand(wsUrl, method, params = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(wsUrl);
    } catch (err) {
      reject(err);
      return;
    }
    if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
      reject(new Error('Refusing non-loopback CDP connection'));
      return;
    }

    const requestId = 1;
    const key = crypto.randomBytes(16).toString('base64');
    const socket = net.createConnection({ host: '127.0.0.1', port: Number(parsed.port) });
    let settled = false;
    let handshakeDone = false;
    let buffer = Buffer.alloc(0);
    let fragmentedChunks = [];

    const finish = (err, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.destroy();
      } catch (_) {}
      if (err) reject(err);
      else resolve(result);
    };

    const timer = setTimeout(() => finish(new Error('CDP request timed out')), 10000);

    const writeMaskedFrame = (opcode, payloadBuf) => {
      const len = payloadBuf.length;
      let header;
      if (len < 126) {
        header = Buffer.alloc(2);
        header[0] = 0x80 | opcode;
        header[1] = 0x80 | len;
      } else if (len < 65536) {
        header = Buffer.alloc(4);
        header[0] = 0x80 | opcode;
        header[1] = 0x80 | 126;
        header.writeUInt16BE(len, 2);
      } else {
        header = Buffer.alloc(10);
        header[0] = 0x80 | opcode;
        header[1] = 0x80 | 127;
        header.writeBigUInt64BE(BigInt(len), 2);
      }
      const mask = crypto.randomBytes(4);
      const masked = Buffer.alloc(len);
      for (let i = 0; i < len; i += 1) {
        masked[i] = payloadBuf[i] ^ mask[i % 4];
      }
      socket.write(Buffer.concat([header, mask, masked]));
    };

    socket.on('connect', () => {
      const reqPath = (parsed.pathname || '/') + (parsed.search || '');
      const headers = [
        `GET ${reqPath} HTTP/1.1`,
        `Host: 127.0.0.1:${parsed.port}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${key}`,
        'Sec-WebSocket-Version: 13',
        '',
        '',
      ].join('\r\n');
      socket.write(headers);
    });

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!handshakeDone) {
        const sepIdx = buffer.indexOf('\r\n\r\n');
        if (sepIdx === -1) return;
        const headerStr = buffer.slice(0, sepIdx).toString('utf8');
        if (!headerStr.includes('101')) {
          finish(new Error('WebSocket handshake rejected'));
          return;
        }
        handshakeDone = true;
        buffer = buffer.slice(sepIdx + 4);
        const msg = JSON.stringify({ id: requestId, method, params });
        writeMaskedFrame(0x1, Buffer.from(msg, 'utf8'));
      }

      while (buffer.length >= 2) {
        const first = buffer[0];
        const second = buffer[1];
        const fin = (first & 0x80) !== 0;
        const opcode = first & 0x0f;
        const isMasked = (second & 0x80) !== 0;
        let payloadLen = second & 0x7f;
        let offset = 2;

        if (payloadLen === 126) {
          if (buffer.length < offset + 2) return;
          payloadLen = buffer.readUInt16BE(offset);
          offset += 2;
        } else if (payloadLen === 127) {
          if (buffer.length < offset + 8) return;
          payloadLen = Number(buffer.readBigUInt64BE(offset));
          offset += 8;
        }

        const maskLen = isMasked ? 4 : 0;
        if (buffer.length < offset + maskLen + payloadLen) return;

        let payload = buffer.slice(offset + maskLen, offset + maskLen + payloadLen);
        if (isMasked) {
          const maskKey = buffer.slice(offset, offset + 4);
          const unmasked = Buffer.alloc(payloadLen);
          for (let i = 0; i < payloadLen; i += 1) {
            unmasked[i] = payload[i] ^ maskKey[i % 4];
          }
          payload = unmasked;
        }
        buffer = buffer.slice(offset + maskLen + payloadLen);

        if (opcode === 0x9) {
          writeMaskedFrame(0xA, payload);
          continue;
        }
        if (opcode === 0x8) {
          finish(new Error('CDP WebSocket closed before response'));
          return;
        }

        if (opcode === 0x1 || opcode === 0x0) {
          fragmentedChunks.push(payload);
          if (fin) {
            const fullText = Buffer.concat(fragmentedChunks).toString('utf8');
            fragmentedChunks = [];
            try {
              const parsedMsg = JSON.parse(fullText);
              if (parsedMsg.id === requestId) {
                if (parsedMsg.error) {
                  finish(new Error(parsedMsg.error.message || 'CDP error'));
                } else {
                  finish(null, parsedMsg.result);
                }
                return;
              }
            } catch (_) {}
          }
        }
      }
    });

    socket.on('error', (err) => finish(err));
    socket.on('close', () => finish(new Error('CDP connection closed')));
  });
}

function cleanupAuthSession() {
  if (!activeAuthSession) return;
  const sessionState = activeAuthSession;
  activeAuthSession = null;

  if (sessionState.pollTimer) {
    clearInterval(sessionState.pollTimer);
  }
  if (sessionState.child && !sessionState.child.killed) {
    try {
      sessionState.child.kill('SIGTERM');
      setTimeout(() => {
        try {
          if (sessionState.child && !sessionState.child.killed) {
            sessionState.child.kill('SIGKILL');
          }
        } catch (_) {}
      }, 1200);
    } catch (_) {}
  }
  if (sessionState.profileDir) {
    setTimeout(() => {
      try {
        fs.rmSync(sessionState.profileDir, { recursive: true, force: true });
      } catch (_) {}
    }, 1500);
  }
}

async function importCdpCookiesIntoSession(cdpCookies) {
  const ses = session.fromPartition(PARTITION_NAME);
  const sameSiteMap = {
    None: 'no_restriction',
    Lax: 'lax',
    Strict: 'strict',
  };

  let imported = 0;
  for (const c of cdpCookies) {
    if (!c || !c.name || typeof c.value !== 'string') continue;
    const rawDomain = String(c.domain || '');
    const lowerDomain = rawDomain.toLowerCase();
    const isRelevant =
      lowerDomain.endsWith('youtube.com') ||
      lowerDomain.endsWith('google.com') ||
      lowerDomain.endsWith('googleusercontent.com');
    if (!isRelevant) continue;

    const cleanHost = rawDomain.replace(/^\./, '') || 'music.youtube.com';
    const cookiePath = c.path || '/';
    const isHostOnly = c.name.startsWith('__Host-') || !rawDomain.startsWith('.');
    const isSecure = Boolean(c.secure) || c.name.startsWith('__Secure-') || c.name.startsWith('__Host-');
    const cookieObj = {
      url: `${isSecure ? 'https' : 'http'}://${cleanHost}${cookiePath}`,
      name: c.name,
      value: c.value,
      path: c.name.startsWith('__Host-') ? '/' : cookiePath,
      secure: isSecure,
      httpOnly: Boolean(c.httpOnly),
      sameSite: sameSiteMap[c.sameSite] || 'unspecified',
    };
    if (!isHostOnly) {
      cookieObj.domain = rawDomain;
    }
    if (typeof c.expires === 'number' && c.expires > 0) {
      cookieObj.expirationDate = c.expires;
    }
    try {
      await ses.cookies.set(cookieObj);
      imported += 1;
    } catch (_) {}
  }

  await ses.cookies.flushStore();
  return imported;
}

async function startExternalBrowserLogin() {
  cleanupAuthSession();
  const browser = findInstalledChromiumBrowser();
  if (!browser) {
    sendAuthStatus({
      state: 'no-browser',
      message: '未检测到本机 Chrome / Edge / Brave 浏览器，请使用下方「默认浏览器打开 + 粘贴 Cookie」方式登录。',
    });
    return { ok: false, reason: 'no-browser' };
  }

  try {
    const port = await getFreeLocalPort();
    const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentune-auth-'));
    const args = [
      `--user-data-dir=${profileDir}`,
      `--remote-debugging-port=${port}`,
      '--remote-debugging-address=127.0.0.1',
      '--no-first-run',
      '--no-default-browser-check',
      '--new-window',
      GOOGLE_LOGIN_URL,
    ];
    if (PROXY_SERVER) {
      args.splice(args.length - 1, 0, `--proxy-server=${PROXY_SERVER}`);
    }

    const child = spawn(browser.path, args, {
      detached: false,
      stdio: 'ignore',
    });

    const sessionState = {
      child,
      port,
      profileDir,
      pollTimer: null,
      checking: false,
    };
    activeAuthSession = sessionState;

    child.on('exit', () => {
      if (activeAuthSession === sessionState) {
        cleanupAuthSession();
        sendAuthStatus({
          state: 'idle',
          message: '外部浏览器窗口已关闭。若尚未完成登录，可重新点击按钮启动。',
        });
      }
    });

    sendAuthStatus({
      state: 'waiting',
      browserName: browser.name,
      message: `已唤起外部 ${browser.name}，请在弹出的真实浏览器中完成 Google 登录；跳转回 YouTube Music 后将自动同步账号并关闭临时窗口。`,
    });

    sessionState.pollTimer = setInterval(async () => {
      if (activeAuthSession !== sessionState || sessionState.checking) return;
      sessionState.checking = true;
      try {
        const targets = await httpGetLocalJson(port, '/json');
        if (!Array.isArray(targets)) return;

        const musicTarget = targets.find(
          (t) =>
            t &&
            t.type === 'page' &&
            typeof t.url === 'string' &&
            t.url.startsWith('https://music.youtube.com') &&
            typeof t.webSocketDebuggerUrl === 'string'
        );
        if (!musicTarget) return;

        let cookies = [];
        try {
          const storageRes = await cdpSendCommand(musicTarget.webSocketDebuggerUrl, 'Storage.getCookies');
          cookies = Array.isArray(storageRes?.cookies) ? storageRes.cookies : [];
        } catch (_) {}

        if (cookies.length === 0) {
          try {
            const netRes = await cdpSendCommand(musicTarget.webSocketDebuggerUrl, 'Network.getAllCookies');
            cookies = Array.isArray(netRes?.cookies) ? netRes.cookies : [];
          } catch (_) {}
        }

        const authCookieNames = new Set(['SAPISID', '__Secure-3PAPISID', 'SID', '__Secure-3PSID', 'LOGIN_INFO']);
        const hasAuthCookie = cookies.some(
          (c) =>
            c &&
            authCookieNames.has(c.name) &&
            typeof c.domain === 'string' &&
            c.domain.toLowerCase().includes('youtube.com')
        );
        if (!hasAuthCookie) return;

        sendAuthStatus({
          state: 'syncing',
          message: '检测到登录成功，正在同步 YouTube Music 账号凭证...',
        });

        const imported = await importCdpCookiesIntoSession(cookies);
        cleanupAuthSession();

        sendAuthStatus({
          state: 'success',
          message: `已成功同步 ${imported} 条登录凭证，正在进入 YouTube Music...`,
        });

        navigateHome();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          mainWindow.focus();
        }
        setTimeout(() => {
          if (authWindow && !authWindow.isDestroyed()) {
            authWindow.close();
          }
        }, 900);
      } catch (_) {
        // Browser may still be starting up; retry on next poll tick
      } finally {
        sessionState.checking = false;
      }
    }, 1500);

    return { ok: true, browserName: browser.name };
  } catch (err) {
    cleanupAuthSession();
    sendAuthStatus({
      state: 'error',
      message: `启动外部浏览器失败：${err && err.message ? err.message : '未知错误'}`,
    });
    return { ok: false };
  }
}

function openAuthWindow() {
  if (authWindow && !authWindow.isDestroyed()) {
    authWindow.show();
    authWindow.focus();
    return;
  }

  const detectedBrowser = findInstalledChromiumBrowser();
  authWindow = new BrowserWindow({
    width: 400,
    height: 316,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
    title: `登录 Google 账号 — ${APP_NAME}`,
    backgroundColor: '#0e0f14',
    webPreferences: {
      preload: path.join(__dirname, 'auth-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  authWindow.setMenuBarVisibility(false);
  authWindow.loadFile(path.join(__dirname, 'auth.html'));

  authWindow.webContents.on('did-finish-load', () => {
    sendAuthStatus({
      state: 'ready',
      browserName: detectedBrowser ? detectedBrowser.name : '',
      message: detectedBrowser
        ? `已检测到本机 ${detectedBrowser.name}，点击下方按钮完成认证即可自动同步。`
        : '未检测到 Chrome / Edge / Brave，请先安装其中任意一款 Chromium 浏览器。',
    });
  });

  authWindow.on('closed', () => {
    cleanupAuthSession();
    authWindow = null;
  });
}

function sendPlayerCommand(action, value) {
  const wc = getMusicWebContents();
  if (!wc) return;
  if (action === 'volume') {
    const clamped = Math.max(0, Math.min(100, Number(value) || 0));
    const script = `(function(vol){
      const video = document.querySelector('video, audio');
      if (video) {
        video.muted = vol === 0;
        video.volume = vol / 100;
      }
      const slider = document.querySelector('#volume-slider, tp-yt-paper-slider#volume-slider');
      if (slider) {
        slider.value = vol;
        slider.dispatchEvent(new Event('value-change', { bubbles: true }));
        slider.dispatchEvent(new Event('change', { bubbles: true }));
        slider.dispatchEvent(new Event('input', { bubbles: true }));
      }
    })(${clamped});`;
    wc.executeJavaScript(script, true).catch(() => {});
    currentTrack = { ...currentTrack, volume: clamped, muted: clamped === 0 };
    broadcastTrackToTray();
    return;
  }

  if (action === 'toggleMute') {
    const script = `(function(){
      const muteBtn = document.querySelector('.volume.ytmusic-player-bar, ytmusic-player-bar #mute-button, ytmusic-player-bar yt-icon-button.volume');
      const video = document.querySelector('video, audio');
      if (muteBtn) {
        muteBtn.click();
      } else if (video) {
        video.muted = !video.muted;
      }
    })();`;
    wc.executeJavaScript(script, true).catch(() => {});
    return;
  }

  if (action === 'toggleLike') {
    const script = `(function(){
      const likeBtn = document.querySelector('ytmusic-player-bar ytmusic-like-button-renderer .like button, ytmusic-player-bar #like-button-renderer .like button');
      if (likeBtn) likeBtn.click();
    })();`;
    wc.executeJavaScript(script, true).catch(() => {});
    return;
  }

  if (action === 'seek') {
    const ratio = Math.max(0, Math.min(1, Number(value) || 0));
    const script = `(function(r){
      const video = document.querySelector('video, audio');
      if (video && Number.isFinite(video.duration) && video.duration > 0) {
        video.currentTime = video.duration * r;
      }
    })(${ratio});`;
    wc.executeJavaScript(script, true).catch(() => {});
    return;
  }

  const selectorMap = {
    toggle: '#play-pause-button',
    next: '.next-button',
    previous: '.previous-button',
  };
  const selector = selectorMap[action];
  if (!selector) return;

  wc.executeJavaScript(`document.querySelector(${JSON.stringify(selector)})?.click();`, true).catch(() => {});
}

function navigateBack() {
  const wc = getMusicWebContents();
  if (!wc) return;
  if (wc.navigationHistory ? wc.navigationHistory.canGoBack() : wc.canGoBack()) {
    if (wc.navigationHistory) wc.navigationHistory.goBack();
    else wc.goBack();
  }
}

function navigateForward() {
  const wc = getMusicWebContents();
  if (!wc) return;
  if (wc.navigationHistory ? wc.navigationHistory.canGoForward() : wc.canGoForward()) {
    if (wc.navigationHistory) wc.navigationHistory.goForward();
    else wc.goForward();
  }
}

function reloadMusicView() {
  const wc = getMusicWebContents();
  if (wc) wc.reload();
}

function navigateToUrl(targetUrl) {
  const wc = getMusicWebContents();
  if (!wc) return;
  if (SANITIZE_UA) {
    wc.setUserAgent(CHROME_MAC_UA);
  }
  wc.loadURL(targetUrl);
}

function navigateHome() {
  navigateToUrl(START_URL);
}

async function navigateSpaOrLoad(targetPath) {
  const wc = getMusicWebContents();
  if (!wc) return;
  const fullUrl = `${START_URL}${targetPath}`;
  const currentUrl = wc.getURL() || '';
  if (!currentUrl.startsWith(START_URL)) {
    navigateToUrl(fullUrl);
    return;
  }
  try {
    const script = `(function(targetPath){
      const candidates = Array.from(document.querySelectorAll('ytmusic-guide-entry-renderer a[href], ytmusic-guide-section-renderer a[href], a[href]'));
      const match = candidates.find((a) => {
        try {
          const u = new URL(a.getAttribute('href'), location.origin);
          const full = u.pathname + u.search;
          if (full === targetPath) return true;
          if (targetPath === '/library' && u.pathname.startsWith('/library')) return true;
          return false;
        } catch (_) { return false; }
      });
      if (match) {
        match.click();
        return 'clicked';
      }
      return 'miss';
    })(${JSON.stringify(targetPath)});`;
    const res = await wc.executeJavaScript(script, true);
    if (res === 'clicked') {
      setTimeout(() => broadcastNavState(), 250);
      return;
    }
  } catch (_) {}
  navigateToUrl(fullUrl);
}

function navigateRoute(route, value) {
  if (route === 'back') return navigateBack();
  if (route === 'forward') return navigateForward();
  if (route === 'reload') return reloadMusicView();
  if (route === 'home') return navigateSpaOrLoad('/');
  if (route === 'explore') return navigateSpaOrLoad('/explore');
  if (route === 'library') return navigateSpaOrLoad('/library');
  if (route === 'liked') return navigateSpaOrLoad('/playlist?list=LM');
  if (route === 'history') return navigateSpaOrLoad('/history');
  if (route === 'search' && typeof value === 'string' && value.trim()) {
    return navigateToUrl(`${START_URL}/search?q=${encodeURIComponent(value.trim())}`);
  }
}

async function importCookieString(raw) {
  const ses = session.fromPartition(PARTITION_NAME);
  const text = String(raw || '').trim();
  if (!text || !text.includes('=')) {
    return { ok: false, count: 0 };
  }

  const cleaned = text.replace(/^cookie:\s*/i, '');
  const pairs = cleaned
    .split(/;\s*/)
    .map((segment) => {
      const idx = segment.indexOf('=');
      if (idx <= 0) return null;
      return { name: segment.slice(0, idx).trim(), value: segment.slice(idx + 1).trim() };
    })
    .filter(Boolean);

  let imported = 0;
  for (const pair of pairs) {
    if (!pair.name || !pair.value) continue;
    const isHostOnly = pair.name.startsWith('__Host-');
    const cookieObj = {
      url: 'https://music.youtube.com',
      name: pair.name,
      value: pair.value,
      path: '/',
      secure: true,
      sameSite: 'no_restriction',
    };
    if (!isHostOnly) {
      cookieObj.domain = '.youtube.com';
    }
    try {
      await ses.cookies.set(cookieObj);
      imported += 1;
    } catch (_) {}
  }

  await ses.cookies.flushStore();
  if (imported > 0) {
    navigateHome();
  }
  return { ok: imported > 0, count: imported };
}

async function importCookiesFromClipboard() {
  const raw = (clipboard.readText() || '').trim();
  const result = await importCookieString(raw);
  if (!result.ok) {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '从浏览器导入 Cookie 登录',
      message: '剪贴板中未检测到有效的 Cookie 字符串',
      detail:
        '请先在 Chrome/Safari 打开并登录 https://music.youtube.com，按 F12 打开开发者工具 → Network → 点击任意请求复制 Request Headers 中的 Cookie 值，然后再点击此菜单即可一键同步登录态。',
    });
    return;
  }

  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Cookie 导入完成',
    message: `已同步 ${result.count} 条会话 Cookie 并刷新页面`,
    detail: '如未立即显示头像，请稍等 2 秒或按 Cmd+R 刷新页面。',
  });
}

function setupAppMenu() {
  const template = [
    ...(process.platform === 'darwin'
      ? [
          {
            label: APP_NAME,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              {
                label: `退出 ${APP_NAME}`,
                accelerator: 'CmdOrCtrl+Q',
                click: () => {
                  isQuitting = true;
                  app.quit();
                },
              },
            ],
          },
        ]
      : []),
    {
      label: '编辑',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: '导航',
      submenu: [
        {
          label: '返回上一页',
          accelerator: 'CmdOrCtrl+[',
          click: () => navigateBack(),
        },
        {
          label: '前进下一页',
          accelerator: 'CmdOrCtrl+]',
          click: () => navigateForward(),
        },
        { type: 'separator' },
        {
          label: '返回 YouTube Music 首页',
          accelerator: 'CmdOrCtrl+Shift+H',
          click: () => navigateHome(),
        },
        {
          label: '重新加载当前页',
          accelerator: 'CmdOrCtrl+R',
          click: () => reloadMusicView(),
        },
      ],
    },
    {
      label: '播放',
      submenu: [
        {
          label: '播放 / 暂停',
          click: () => sendPlayerCommand('toggle'),
        },
        {
          label: '上一首',
          click: () => sendPlayerCommand('previous'),
        },
        {
          label: '下一首',
          click: () => sendPlayerCommand('next'),
        },
        { type: 'separator' },
        {
          label: '沉浸播放 / 实时歌词视图',
          accelerator: 'CmdOrCtrl+L',
          click: () => setImmersiveOpen(!isImmersiveOpen),
        },
        {
          label: '显示桌面悬浮歌词',
          type: 'checkbox',
          checked: desktopLyricsEnabled,
          click: (menuItem) => setDesktopLyricsEnabled(menuItem.checked),
        },
        { type: 'separator' },
        {
          label: '启用全局媒体键（后台响应键盘/耳机）',
          type: 'checkbox',
          checked: mediaKeysEnabled,
          click: (menuItem) => setMediaKeysEnabled(menuItem.checked),
        },
      ],
    },
    {
      label: '账号',
      submenu: [
        {
          label: '使用外部浏览器登录 Google 账号（推荐）',
          click: () => openAuthWindow(),
        },
        {
          label: '从剪贴板导入浏览器 Cookie 登录（备用）',
          click: () => {
            importCookiesFromClipboard().catch(() => {});
          },
        },
        { type: 'separator' },
        {
          label: '返回 YouTube Music 首页',
          click: () => navigateHome(),
        },
        {
          label: '清除账号登录缓存',
          click: async () => {
            const ses = session.fromPartition(PARTITION_NAME);
            await ses.clearStorageData({ storages: ['cookies', 'localstorage'] });
            navigateHome();
          },
        },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createTrayWindow() {
  if (trayWindow && !trayWindow.isDestroyed()) return trayWindow;

  trayWindow = new BrowserWindow({
    width: 320,
    height: 214,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    transparent: true,
    vibrancy: process.platform === 'darwin' ? 'popover' : undefined,
    visualEffectState: 'active',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'tray-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  trayWindow.loadFile(path.join(__dirname, 'tray.html'));
  trayWindow.webContents.on('did-finish-load', () => {
    broadcastTrackToTray();
  });

  trayWindow.on('blur', () => {
    if (trayWindow && !trayWindow.isDestroyed() && trayWindow.isVisible()) {
      trayWindow.hide();
    }
  });

  return trayWindow;
}

function toggleTrayPopover() {
  const win = createTrayWindow();
  if (win.isVisible()) {
    win.hide();
    return;
  }

  const trayBounds = tray.getBounds();
  const winBounds = win.getBounds();
  const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });
  const workArea = display.workArea;

  let x = Math.round(trayBounds.x + trayBounds.width / 2 - winBounds.width / 2);
  x = Math.max(workArea.x + 8, Math.min(x, workArea.x + workArea.width - winBounds.width - 8));
  const y =
    process.platform === 'darwin'
      ? Math.round(trayBounds.y + trayBounds.height + 6)
      : Math.round(trayBounds.y - winBounds.height - 6);

  win.setPosition(x, y, false);
  broadcastTrackToTray();
  win.show();
  win.focus();
}

function setupTray() {
  if (tray) return;
  const svgIcon =
    'data:image/svg+xml;base64,' +
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.5" fill="none" stroke="black" stroke-width="1.5"/><polygon points="6.5,5.2 11.2,8 6.5,10.8" fill="black"/></svg>'
    ).toString('base64');
  const icon = nativeImage.createFromDataURL(svgIcon);
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip(APP_NAME);

  createTrayWindow();

  tray.on('click', () => {
    toggleTrayPopover();
  });

  tray.on('right-click', () => {
    const contextMenu = Menu.buildFromTemplate([
      {
        label: `显示 ${APP_NAME}`,
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
        },
      },
      {
        label: '返回音乐首页',
        click: () => {
          navigateHome();
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
        },
      },
      { type: 'separator' },
      {
        label: '显示桌面悬浮歌词',
        type: 'checkbox',
        checked: desktopLyricsEnabled,
        click: (menuItem) => setDesktopLyricsEnabled(menuItem.checked),
      },
      {
        label: '启用全局媒体键',
        type: 'checkbox',
        checked: mediaKeysEnabled,
        click: (menuItem) => setMediaKeysEnabled(menuItem.checked),
      },
      { type: 'separator' },
      {
        label: '退出客户端',
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]);
    tray.popUpContextMenu(contextMenu);
  });
}

function applyMediaShortcuts(enabled) {
  for (const shortcut of MEDIA_SHORTCUTS) {
    globalShortcut.unregister(shortcut);
  }
  if (!enabled) return;
  globalShortcut.register('MediaPlayPause', () => sendPlayerCommand('toggle'));
  globalShortcut.register('MediaNextTrack', () => sendPlayerCommand('next'));
  globalShortcut.register('MediaPreviousTrack', () => sendPlayerCommand('previous'));
}

function registerMediaShortcuts() {
  applyMediaShortcuts(mediaKeysEnabled);
}

async function createMainWindow() {
  const ses = session.fromPartition(PARTITION_NAME);

  if (PROXY_SERVER) {
    await ses.setProxy({ proxyRules: PROXY_SERVER });
  }

  // Grant media & DRM permissions so YouTube Premium audio streams do not error out mid-playlist
  ses.setPermissionRequestHandler((_webContents, permission, callback) => {
    const allowed = ['media', 'mediaKeySystem', 'notifications', 'fullscreen', 'clipboard-read'];
    callback(allowed.includes(permission));
  });

  if (SANITIZE_UA) {
    app.userAgentFallback = CHROME_MAC_UA;
    ses.setUserAgent(CHROME_MAC_UA);

    // Only remove "Electron" brand token from Sec-CH-UA if present; keep UA completely consistent across all requests
    ses.webRequest.onBeforeSendHeaders((details, callback) => {
      const headers = { ...details.requestHeaders };
      let mutated = false;
      for (const key of Object.keys(headers)) {
        const lower = key.toLowerCase();
        if (lower === 'sec-ch-ua' && typeof headers[key] === 'string' && headers[key].includes('Electron')) {
          delete headers[key];
          mutated = true;
        }
      }
      callback(mutated ? { requestHeaders: headers } : { cancel: false });
    });
  }

  const appIconPath = path.join(__dirname, '..', 'build', 'icon.png');
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 620,
    title: APP_NAME,
    icon: fs.existsSync(appIconPath) ? appIconPath : undefined,
    backgroundColor: '#111218',
    titleBarStyle: HIDDEN_TITLEBAR ? 'hiddenInset' : 'default',
    trafficLightPosition: HIDDEN_TITLEBAR ? { x: 16, y: 16 } : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'shell-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  musicView = new WebContentsView({
    webPreferences: {
      partition: PARTITION_NAME,
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  musicView.setBackgroundColor('#030303');
  mainWindow.contentView.addChildView(musicView);
  layoutMusicView();

  mainWindow.on('resize', () => layoutMusicView());
  mainWindow.on('maximize', () => layoutMusicView());
  mainWindow.on('unmaximize', () => layoutMusicView());
  mainWindow.on('enter-full-screen', () => layoutMusicView());
  mainWindow.on('leave-full-screen', () => layoutMusicView());

  const musicWc = musicView.webContents;

  // Intercept Google Sign-In navigations & 302 redirects and route them to External Browser Login (prevents embedded redirect loops)
  musicWc.on('will-navigate', (event, url) => {
    if (isGoogleAuthUrl(url)) {
      event.preventDefault();
      openAuthWindow();
      return;
    }
    if (!isAllowedInAppUrl(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  musicWc.on('will-redirect', (event, url, _isInPlace, isMainFrame) => {
    if (!isMainFrame) return;
    if (isGoogleAuthUrl(url)) {
      event.preventDefault();
      openAuthWindow();
      return;
    }
    if (!isAllowedInAppUrl(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  musicWc.on('did-navigate', () => broadcastNavState());
  musicWc.on('did-navigate-in-page', () => broadcastNavState());
  musicWc.on('did-finish-load', () => broadcastNavState());

  // Native macOS trackpad 2-finger swipe back / forward
  mainWindow.on('swipe', (_event, direction) => {
    if (direction === 'left') navigateBack();
    else if (direction === 'right') navigateForward();
  });

  // Route Google Sign-In popups to External Browser Login; send other external links to default browser
  musicWc.setWindowOpenHandler(({ url }) => {
    if (isGoogleAuthUrl(url)) {
      openAuthWindow();
      return { action: 'deny' };
    }
    if (isAllowedInAppUrl(url)) {
      navigateToUrl(url);
      return { action: 'deny' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  musicWc.on('dom-ready', () => {
    const cssPath = path.join(__dirname, 'inject.css');
    if (fs.existsSync(cssPath)) {
      const css = fs.readFileSync(cssPath, 'utf-8');
      musicWc.insertCSS(css).catch(() => {});
    }
    broadcastNavState();
  });

  mainWindow.on('close', (event) => {
    if (CLOSE_TO_TRAY && !isQuitting && process.platform === 'darwin') {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    musicView = null;
    mainWindow = null;
  });

  mainWindow.loadFile(path.join(__dirname, 'shell.html'));
  navigateHome();
}

ipcMain.on('ytm:track-update', (_event, payload) => {
  if (!payload || typeof payload !== 'object') return;
  const playing = Boolean(payload.playing);
  const prevKey = `${currentTrack.title}|${normalizeArtistName(currentTrack.artist)}`;
  currentTrack = {
    title: String(payload.title || '未在播放'),
    artist: String(payload.artist || APP_NAME),
    artwork: typeof payload.artwork === 'string' ? payload.artwork : '',
    playing,
    currentTime: Number.isFinite(payload.currentTime) ? payload.currentTime : 0,
    duration: Number.isFinite(payload.duration) ? payload.duration : 0,
    volume: Number.isFinite(payload.volume) ? Math.max(0, Math.min(100, Math.round(payload.volume))) : currentTrack.volume,
    muted: Boolean(payload.muted),
    liked: Boolean(payload.liked),
  };
  updatePowerSaveBlocker(playing);
  broadcastTrackToTray();

  const nextKey = `${currentTrack.title}|${normalizeArtistName(currentTrack.artist)}`;
  if (nextKey !== prevKey) {
    fetchLyricsForTrack(currentTrack.title, currentTrack.artist, currentTrack.duration).catch(() => {});
  }
});

ipcMain.on('ytm:nav-action', (_event, action) => {
  navigateRoute(action);
});

ipcMain.on('ytm:shell-nav', (_event, payload) => {
  if (!payload || typeof payload !== 'object') return;
  navigateRoute(payload.action, payload.value);
});

ipcMain.on('ytm:shell-player', (_event, payload) => {
  if (!payload || typeof payload !== 'object') return;
  sendPlayerCommand(payload.action, payload.value);
});

ipcMain.on('ytm:shell-open-auth', () => {
  openAuthWindow();
});

ipcMain.on('ytm:shell-set-media-keys', (_event, enabled) => {
  setMediaKeysEnabled(Boolean(enabled));
});

ipcMain.on('ytm:shell-set-desktop-lyrics', (_event, enabled) => {
  setDesktopLyricsEnabled(Boolean(enabled));
});

ipcMain.on('ytm:shell-set-immersive', (_event, open) => {
  setImmersiveOpen(Boolean(open));
});

ipcMain.on('ytm:account-update', (_event, payload) => {
  if (!payload || typeof payload !== 'object') return;
  accountState = {
    loggedIn: Boolean(payload.loggedIn),
    name: typeof payload.name === 'string' ? payload.name : '',
    avatar: typeof payload.avatar === 'string' ? payload.avatar : '',
  };
  broadcastAccountState();
});

ipcMain.on('ytm:shell-logout', () => {
  logoutAccount().catch(() => {});
});

ipcMain.on('ytm:shell-ready', () => {
  broadcastSettings();
  broadcastNavState();
  broadcastTrackToTray();
  broadcastLyricsState();
  broadcastAccountState();
  refreshAccountFromCookies().catch(() => {});
});

ipcMain.on('ytm:lyrics-overlay-ready', () => {
  broadcastTrackToTray();
  broadcastLyricsState();
});

ipcMain.on('ytm:tray-command', (_event, payload) => {
  if (!payload || typeof payload !== 'object') return;
  if (payload.action === 'showMain') {
    if (trayWindow && !trayWindow.isDestroyed()) trayWindow.hide();
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
    return;
  }
  sendPlayerCommand(payload.action, payload.value);
});

ipcMain.handle('ytm:auth-start-external', async () => {
  return startExternalBrowserLogin();
});

ipcMain.on('ytm:auth-open-default', () => {
  shell.openExternal(GOOGLE_LOGIN_URL);
});

ipcMain.handle('ytm:auth-import-cookie', async (_event, rawCookie) => {
  const res = await importCookieString(rawCookie);
  if (res.ok) {
    cleanupAuthSession();
    sendAuthStatus({
      state: 'success',
      message: `已导入 ${res.count} 条 Cookie，正在刷新 YouTube Music...`,
    });
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
    setTimeout(() => {
      if (authWindow && !authWindow.isDestroyed()) {
        authWindow.close();
      }
    }, 800);
  }
  return res;
});

ipcMain.on('ytm:auth-cancel', () => {
  cleanupAuthSession();
  if (authWindow && !authWindow.isDestroyed()) {
    authWindow.close();
  }
});

app.whenReady().then(async () => {
  nativeTheme.themeSource = 'dark';
  if (process.platform === 'darwin' && app.dock) {
    const dockIconPath = path.join(__dirname, '..', 'build', 'icon.png');
    if (fs.existsSync(dockIconPath)) {
      app.dock.setIcon(dockIconPath);
    }
  }
  loadSettings();
  setupAppMenu();
  await createMainWindow();
  setupTray();
  registerMediaShortcuts();
  refreshAccountFromCookies().catch(() => {});
  if (desktopLyricsEnabled) {
    createLyricsWindow();
  }

  app.on('activate', () => {
    if (mainWindow) {
      mainWindow.show();
    } else {
      createMainWindow();
    }
  });
});

app.on('before-quit', () => {
  isQuitting = true;
  cleanupAuthSession();
  updatePowerSaveBlocker(false);
  if (lyricsWindow && !lyricsWindow.isDestroyed()) {
    lyricsWindow.destroy();
    lyricsWindow = null;
  }
});

app.on('will-quit', () => {
  cleanupAuthSession();
  globalShortcut.unregisterAll();
  updatePowerSaveBlocker(false);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
