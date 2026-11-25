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
const fs = require('fs');
const path = require('path');

// Prevent Chromium/macOS from throttling background audio timers or blocking autoplay across track transitions
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

const APP_NAME = "OpenTune";
const START_URL = "https://music.youtube.com";
const PARTITION_NAME = 'persist:ytmusic';
const SANITIZE_UA = true;
const ENABLE_MEDIA_KEYS = true;
const CLOSE_TO_TRAY = true;
const HIDDEN_TITLEBAR = true;
const PROXY_SERVER = "";

const CHROME_VERSION = process.versions.chrome || '130.0.0.0';
const CHROME_MAC_UA = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_VERSION} Safari/537.36`;
// Firefox UA avoids Chromium Sec-CH-UA / embedded attestation checks on accounts.google.com
const FIREFOX_MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:132.0) Gecko/20100101 Firefox/132.0';

let mainWindow = null;
let tray = null;
let trayWindow = null;
let isQuitting = false;
let powerBlockerId = null;

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
    return (
      host === 'music.youtube.com' ||
      host === 'www.youtube.com' && parsed.pathname.startsWith('/signin') ||
      isGoogleAuthUrl(rawUrl)
    );
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

function attachDynamicUaListeners(contents) {
  if (!SANITIZE_UA || !contents) return;
  const syncUaForUrl = (_event, url) => {
    const targetUa = isGoogleAuthUrl(url) ? FIREFOX_MAC_UA : CHROME_MAC_UA;
    if (contents.getUserAgent() !== targetUa) {
      contents.setUserAgent(targetUa);
    }
  };
  contents.on('will-navigate', syncUaForUrl);
  contents.on('did-start-navigation', syncUaForUrl);
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

async function importCookiesFromClipboard() {
  const ses = session.fromPartition(PARTITION_NAME);
  const raw = (clipboard.readText() || '').trim();
  if (!raw || !raw.includes('=')) {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '从浏览器导入 Cookie 登录',
      message: '剪贴板中未检测到有效的 Cookie 字符串',
      detail:
        '请先在 Chrome/Safari 打开并登录 https://music.youtube.com，按 F12 打开开发者工具 → Network → 点击任意请求复制 Request Headers 中的 Cookie 值，然后再点击此菜单即可一键同步登录态。',
    });
    return;
  }

  const cleaned = raw.replace(/^cookie:\s*/i, '');
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
  navigateHome();
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Cookie 导入完成',
    message: `已同步 ${imported} 条会话 Cookie 并刷新页面`,
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
      label: '账号',
      submenu: [
        {
          label: '兼容模式登录 Google 账号',
          click: () => {
            if (!mainWindow) return;
            mainWindow.webContents.setUserAgent(FIREFOX_MAC_UA);
            mainWindow.loadURL(
              'https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fmusic.youtube.com%2F',
              { userAgent: FIREFOX_MAC_UA }
            );
          },
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

function registerMediaShortcuts() {
  if (!ENABLE_MEDIA_KEYS) return;
  globalShortcut.register('MediaPlayPause', () => sendPlayerCommand('toggle'));
  globalShortcut.register('MediaNextTrack', () => sendPlayerCommand('next'));
  globalShortcut.register('MediaPreviousTrack', () => sendPlayerCommand('previous'));
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

    // Only alter headers on Google auth hosts (Firefox UA + strip Sec-CH-UA).
    // Leave googlevideo.com media stream CDN headers untouched to prevent mid-playback 403/CORS failures!
    ses.webRequest.onBeforeSendHeaders((details, callback) => {
      const isAuth = isGoogleAuthUrl(details.url);
      if (!isAuth) {
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
        return;
      }

      const headers = { ...details.requestHeaders };
      for (const key of Object.keys(headers)) {
        const lower = key.toLowerCase();
        if (lower === 'user-agent' || lower.startsWith('sec-ch-ua')) {
          delete headers[key];
        }
      }
      headers['User-Agent'] = FIREFOX_MAC_UA;
      callback({ requestHeaders: headers });
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

  attachDynamicUaListeners(mainWindow.webContents);

  // Navigation guard: keep main window inside YouTube Music & Google Sign-In; open external/help links in default browser
  mainWindow.webContents.on('will-navigate', (event, url) => {
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

  // Allow Google Sign-In popups in the same session; send all other external links to default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedInAppUrl(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 520,
          height: 680,
          webPreferences: {
            partition: PARTITION_NAME,
            contextIsolation: true,
            nodeIntegration: false,
          },
        },
      };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('did-create-window', (childWin, details) => {
    attachDynamicUaListeners(childWin.webContents);
    if (SANITIZE_UA && isGoogleAuthUrl(details.url)) {
      childWin.webContents.setUserAgent(FIREFOX_MAC_UA);
    }
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

app.whenReady().then(async () => {
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
  updatePowerSaveBlocker(false);
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  updatePowerSaveBlocker(false);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
