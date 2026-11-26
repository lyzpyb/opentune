const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  nativeImage,
  powerSaveBlocker,
  screen,
  session,
  shell,
} = require('electron');
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
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

const CHROME_VERSION = process.versions.chrome || '130.0.0.0';
const CHROME_MAC_UA = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_VERSION} Safari/537.36`;

let mainWindow = null;
let tray = null;
let trayWindow = null;
let authWindow = null;
let isQuitting = false;
let powerBlockerId = null;
let mediaKeysEnabled = ENABLE_MEDIA_KEYS;

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

function setMediaKeysEnabled(enabled) {
  mediaKeysEnabled = Boolean(enabled);
  saveSettings({ enableMediaKeys: mediaKeysEnabled });
  applyMediaShortcuts(mediaKeysEnabled);
  setupAppMenu();
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

function broadcastNavState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const wc = mainWindow.webContents;
  const currentUrl = wc.getURL() || START_URL;
  let onMusicHome = true;
  try {
    onMusicHome = new URL(currentUrl).hostname.toLowerCase() === 'music.youtube.com';
  } catch (_) {}
  wc.send('ytm:nav-state', {
    canGoBack: wc.navigationHistory ? wc.navigationHistory.canGoBack() : wc.canGoBack(),
    canGoForward: wc.navigationHistory ? wc.navigationHistory.canGoForward() : wc.canGoForward(),
    url: currentUrl,
    onMusicHome,
    hiddenTitlebar: HIDDEN_TITLEBAR,
  });
}

function broadcastTrackToTray() {
  if (tray) {
    tray.setToolTip(`${APP_NAME} — ${currentTrack.title}`);
  }
  if (trayWindow && !trayWindow.isDestroyed()) {
    trayWindow.webContents.send('ytm:tray-state', currentTrack);
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
    width: 480,
    height: 540,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
    title: `外部浏览器登录 — ${APP_NAME}`,
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
        ? `已检测到本机 ${detectedBrowser.name}，点击下方按钮即可拉起真实浏览器登录并自动回传登录态。`
        : '未检测到 Chrome / Edge / Brave，可使用下方默认浏览器打开并粘贴 Cookie 完成登录。',
    });
  });

  authWindow.on('closed', () => {
    cleanupAuthSession();
    authWindow = null;
  });
}

function sendPlayerCommand(action, value) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
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
    mainWindow.webContents.executeJavaScript(script, true).catch(() => {});
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
    mainWindow.webContents.executeJavaScript(script, true).catch(() => {});
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
    mainWindow.webContents.executeJavaScript(script, true).catch(() => {});
    return;
  }

  const selectorMap = {
    toggle: '#play-pause-button',
    next: '.next-button',
    previous: '.previous-button',
  };
  const selector = selectorMap[action];
  if (!selector) return;

  mainWindow.webContents
    .executeJavaScript(`document.querySelector(${JSON.stringify(selector)})?.click();`, true)
    .catch(() => {});
}

function navigateBack() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const wc = mainWindow.webContents;
  if (wc.navigationHistory ? wc.navigationHistory.canGoBack() : wc.canGoBack()) {
    if (wc.navigationHistory) wc.navigationHistory.goBack();
    else wc.goBack();
  }
}

function navigateForward() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const wc = mainWindow.webContents;
  if (wc.navigationHistory ? wc.navigationHistory.canGoForward() : wc.canGoForward()) {
    if (wc.navigationHistory) wc.navigationHistory.goForward();
    else wc.goForward();
  }
}

function navigateHome() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (SANITIZE_UA) {
    mainWindow.webContents.setUserAgent(CHROME_MAC_UA);
  }
  mainWindow.loadURL(START_URL);
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
          click: () => mainWindow?.webContents.reload(),
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

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 620,
    title: APP_NAME,
    backgroundColor: '#030303',
    titleBarStyle: HIDDEN_TITLEBAR ? 'hiddenInset' : 'default',
    trafficLightPosition: HIDDEN_TITLEBAR ? { x: 14, y: 14 } : undefined,
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

  // Intercept Google Sign-In navigations & 302 redirects and route them to External Browser Login (prevents embedded redirect loops)
  mainWindow.webContents.on('will-navigate', (event, url) => {
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

  mainWindow.webContents.on('will-redirect', (event, url, _isInPlace, isMainFrame) => {
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

  mainWindow.webContents.on('did-navigate', () => broadcastNavState());
  mainWindow.webContents.on('did-navigate-in-page', () => broadcastNavState());
  mainWindow.webContents.on('did-finish-load', () => broadcastNavState());

  // Native macOS trackpad 2-finger swipe back / forward
  mainWindow.on('swipe', (_event, direction) => {
    if (direction === 'left') navigateBack();
    else if (direction === 'right') navigateForward();
  });

  // Route Google Sign-In popups to External Browser Login; send other external links to default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isGoogleAuthUrl(url)) {
      openAuthWindow();
      return { action: 'deny' };
    }
    if (isAllowedInAppUrl(url)) {
      mainWindow.loadURL(url);
      return { action: 'deny' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('dom-ready', () => {
    const cssPath = path.join(__dirname, 'inject.css');
    if (fs.existsSync(cssPath)) {
      const css = fs.readFileSync(cssPath, 'utf-8');
      mainWindow.webContents.insertCSS(css).catch(() => {});
    }
    broadcastNavState();
  });

  mainWindow.on('close', (event) => {
    if (CLOSE_TO_TRAY && !isQuitting && process.platform === 'darwin') {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.loadURL(START_URL);
}

ipcMain.on('ytm:track-update', (_event, payload) => {
  if (!payload || typeof payload !== 'object') return;
  const playing = Boolean(payload.playing);
  currentTrack = {
    title: String(payload.title || '未在播放'),
    artist: String(payload.artist || APP_NAME),
    artwork: typeof payload.artwork === 'string' ? payload.artwork : '',
    playing,
    currentTime: Number.isFinite(payload.currentTime) ? payload.currentTime : 0,
    duration: Number.isFinite(payload.duration) ? payload.duration : 0,
    volume: Number.isFinite(payload.volume) ? Math.max(0, Math.min(100, Math.round(payload.volume))) : currentTrack.volume,
    muted: Boolean(payload.muted),
  };
  updatePowerSaveBlocker(playing);
  broadcastTrackToTray();
});

ipcMain.on('ytm:nav-action', (_event, action) => {
  if (action === 'back') navigateBack();
  else if (action === 'forward') navigateForward();
  else if (action === 'reload') mainWindow?.webContents.reload();
  else if (action === 'home') navigateHome();
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
  loadSettings();
  setupAppMenu();
  await createMainWindow();
  setupTray();
  registerMediaShortcuts();

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
