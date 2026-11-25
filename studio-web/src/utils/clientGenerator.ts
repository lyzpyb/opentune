import type { ClientConfig, GeneratedFile } from '../types/client';

function slugifyProductName(name: string): string {
  const ascii = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return ascii || 'ytm-native-client';
}

function packageToPath(bundleId: string): string {
  return bundleId.trim().replace(/\./g, '/');
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function generateClientProjectFiles(config: ClientConfig): GeneratedFile[] {
  const pkgSlug = slugifyProductName(config.appName);
  const pkgPath = packageToPath(config.bundleId);
  const safeAppName = config.appName.trim() || 'YT Music Native';
  const safeBundleId = config.bundleId.trim() || 'com.custom.ytmusic';
  const safeStartUrl = config.startUrl.trim() || 'https://music.youtube.com';
  const safeVersion = config.version.trim() || '1.0.0';
  const safeProxy = config.proxyServer.trim();

  const macArchYaml =
    config.macArch === 'universal'
      ? '        - universal'
      : config.macArch === 'arm64'
        ? '        - arm64'
        : '        - x64';

  const macDistScript =
    config.macArch === 'universal'
      ? 'electron-builder --mac dmg --universal'
      : config.macArch === 'arm64'
        ? 'electron-builder --mac dmg --arm64'
        : 'electron-builder --mac dmg --x64';

  const files: GeneratedFile[] = [];

  // =========================================================================
  // 1. macOS Electron (.dmg) Project
  // =========================================================================

  files.push({
    path: 'macos-electron/package.json',
    target: 'macos',
    language: 'json',
    description: 'macOS Electron 依赖配置与 .dmg 打包脚本',
    content: JSON.stringify(
      {
        name: `${pkgSlug}-macos`,
        productName: safeAppName,
        version: safeVersion,
        description: `${safeAppName} — Native macOS desktop client wrapping YouTube Music Web with Premium support`,
        main: 'src/main.js',
        author: 'YTM Native Studio',
        license: 'MIT',
        scripts: {
          start: 'electron .',
          'dist:mac': macDistScript,
          'dist:mac:arm64': 'electron-builder --mac dmg --arm64',
          'dist:mac:x64': 'electron-builder --mac dmg --x64',
          'dist:mac:universal': 'electron-builder --mac dmg --universal',
        },
        devDependencies: {
          electron: '^33.2.0',
          'electron-builder': '^25.1.8',
        },
      },
      null,
      2
    ),
  });

  files.push({
    path: 'macos-electron/electron-builder.yml',
    target: 'macos',
    language: 'yaml',
    description: 'macOS .dmg 安装镜像配置（含架构、应用分类与 Hardened Runtime）',
    content: `appId: ${safeBundleId}
productName: "${safeAppName}"
directories:
  output: dist
files:
  - src/**/*
  - package.json
mac:
  category: public.app-category.music
  hardenedRuntime: true
  gatekeeperAssess: false
  entitlements: entitlements.mac.plist
  entitlementsInherit: entitlements.mac.plist
  target:
    - target: dmg
      arch:
${macArchYaml}
dmg:
  artifactName: "${pkgSlug}-${safeVersion}-\${arch}.dmg"
  window:
    width: 540
    height: 380
  contents:
    - x: 140
      y: 190
      type: file
    - x: 400
      y: 190
      type: link
      path: /Applications
`,
  });

  files.push({
    path: 'macos-electron/entitlements.mac.plist',
    target: 'macos',
    language: 'xml',
    description: 'macOS 沙盒外音频与 V8 JIT 运行权限声明',
    content: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <key>com.apple.security.cs.disable-library-validation</key>
    <true/>
    <key>com.apple.security.network.client</key>
    <true/>
  </dict>
</plist>
`,
  });

  files.push({
    path: 'macos-electron/src/main.js',
    target: 'macos',
    language: 'javascript',
    description: 'Electron 主进程：防播放中断、菜单栏封面/音量迷你控台、原生返回导航与登录防拦截',
    content: `const {
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

const APP_NAME = ${JSON.stringify(safeAppName)};
const START_URL = ${JSON.stringify(safeStartUrl)};
const PARTITION_NAME = ${config.persistLoginSession ? "'persist:ytmusic'" : "'ytmusic-ephemeral'"};
const SANITIZE_UA = ${config.sanitizeUserAgent};
const ENABLE_MEDIA_KEYS = ${config.macMediaKeys};
const CLOSE_TO_TRAY = ${config.macCloseToTray};
const HIDDEN_TITLEBAR = ${config.macHiddenTitlebar};
const PROXY_SERVER = ${JSON.stringify(safeProxy)};

const CHROME_VERSION = process.versions.chrome || '130.0.0.0';
const CHROME_MAC_UA = \`Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/\${CHROME_VERSION} Safari/537.36\`;
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
    tray.setToolTip(\`\${APP_NAME} — \${currentTrack.title}\`);
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
    const script = \`(function(vol){
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
    })(\${clamped});\`;
    mainWindow.webContents.executeJavaScript(script, true).catch(() => {});
    currentTrack = { ...currentTrack, volume: clamped, muted: clamped === 0 };
    broadcastTrackToTray();
    return;
  }

  if (action === 'toggleMute') {
    const script = \`(function(){
      const muteBtn = document.querySelector('.volume.ytmusic-player-bar, ytmusic-player-bar #mute-button, ytmusic-player-bar yt-icon-button.volume');
      const video = document.querySelector('video, audio');
      if (muteBtn) {
        muteBtn.click();
      } else if (video) {
        video.muted = !video.muted;
      }
    })();\`;
    mainWindow.webContents.executeJavaScript(script, true).catch(() => {});
    return;
  }

  if (action === 'seek') {
    const ratio = Math.max(0, Math.min(1, Number(value) || 0));
    const script = \`(function(r){
      const video = document.querySelector('video, audio');
      if (video && Number.isFinite(video.duration) && video.duration > 0) {
        video.currentTime = video.duration * r;
      }
    })(\${ratio});\`;
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
    .executeJavaScript(\`document.querySelector(\${JSON.stringify(selector)})?.click();\`, true)
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

  const cleaned = raw.replace(/^cookie:\\s*/i, '');
  const pairs = cleaned
    .split(/;\\s*/)
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
    message: \`已同步 \${imported} 条会话 Cookie 并刷新页面\`,
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
                label: \`退出 \${APP_NAME}\`,
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
        label: \`显示 \${APP_NAME}\`,
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
`,
  });

  files.push({
    path: 'macos-electron/src/preload.js',
    target: 'macos',
    language: 'javascript',
    description: 'Preload 桥接脚本：原生返回/首页工具栏、播放错误自动恢复、防休眠弹窗与封面/音量状态同步',
    content: `const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ytmNativeBridge', {
  platform: process.platform,
  reportTrack(payload) {
    ipcRenderer.send('ytm:track-update', payload);
  },
  navigate(action) {
    ipcRenderer.send('ytm:nav-action', action);
  },
});

let navBarRefs = null;
let latestNavState = {
  canGoBack: false,
  canGoForward: false,
  onMusicHome: true,
  hiddenTitlebar: ${config.macHiddenTitlebar},
};

function updateNavBarUi(state) {
  latestNavState = { ...latestNavState, ...state };
  if (!navBarRefs) return;
  navBarRefs.backBtn.disabled = !latestNavState.canGoBack;
  navBarRefs.forwardBtn.disabled = !latestNavState.canGoForward;
  navBarRefs.returnBadge.style.display = latestNavState.onMusicHome ? 'none' : 'inline-flex';
  navBarRefs.container.style.left = latestNavState.hiddenTitlebar ? '78px' : '12px';
}

function mountNativeNavBar() {
  if (document.getElementById('ytm-native-nav-host')) return;
  if (!document.documentElement) return;

  const host = document.createElement('div');
  host.id = 'ytm-native-nav-host';
  host.style.cssText = 'position:fixed;top:0;left:0;z-index:2147483647;pointer-events:none;';
  const shadow = host.attachShadow({ mode: 'open' });

  shadow.innerHTML = \`
    <style>
      .bar {
        position: fixed;
        top: 10px;
        left: \${latestNavState.hiddenTitlebar ? '78px' : '12px'};
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 3px 5px;
        border-radius: 8px;
        background: rgba(18, 19, 24, 0.86);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid rgba(255, 255, 255, 0.12);
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
        pointer-events: auto;
        -webkit-app-region: no-drag;
        font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
      }
      button {
        appearance: none;
        border: none;
        background: transparent;
        color: #f4f4f5;
        width: 24px;
        height: 24px;
        border-radius: 6px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        font-size: 13px;
        line-height: 1;
        transition: background 120ms ease, opacity 120ms ease;
      }
      button:hover:not(:disabled) {
        background: rgba(255, 255, 255, 0.14);
      }
      button:disabled {
        opacity: 0.32;
        cursor: default;
      }
      .return-btn {
        width: auto;
        padding: 0 9px;
        margin-left: 4px;
        font-size: 11px;
        font-weight: 600;
        background: #ff0033;
        color: #ffffff;
        display: none;
      }
      .return-btn:hover {
        background: #e0002d !important;
      }
    </style>
    <div class="bar" id="bar">
      <button id="back" title="返回上一页 (⌘[)" aria-label="返回">←</button>
      <button id="forward" title="前进下一页 (⌘])" aria-label="前进">→</button>
      <button id="reload" title="刷新页面 (⌘R)" aria-label="刷新">↻</button>
      <button id="home" title="返回 YouTube Music 首页 (⇧⌘H)" aria-label="首页">⌂</button>
      <button id="returnBadge" class="return-btn" title="回到 YouTube Music 主界面">返回音乐首页</button>
    </div>
  \`;

  const container = shadow.getElementById('bar');
  const backBtn = shadow.getElementById('back');
  const forwardBtn = shadow.getElementById('forward');
  const reloadBtn = shadow.getElementById('reload');
  const homeBtn = shadow.getElementById('home');
  const returnBadge = shadow.getElementById('returnBadge');

  backBtn.addEventListener('click', () => ipcRenderer.send('ytm:nav-action', 'back'));
  forwardBtn.addEventListener('click', () => ipcRenderer.send('ytm:nav-action', 'forward'));
  reloadBtn.addEventListener('click', () => ipcRenderer.send('ytm:nav-action', 'reload'));
  homeBtn.addEventListener('click', () => ipcRenderer.send('ytm:nav-action', 'home'));
  returnBadge.addEventListener('click', () => ipcRenderer.send('ytm:nav-action', 'home'));

  document.documentElement.appendChild(host);
  navBarRefs = { container, backBtn, forwardBtn, returnBadge };
  updateNavBarUi(latestNavState);
}

ipcRenderer.on('ytm:nav-state', (_event, state) => {
  if (state && typeof state === 'object') {
    updateNavBarUi(state);
  }
});

window.addEventListener('DOMContentLoaded', () => {
  mountNativeNavBar();

  let lastSnapshot = '';
  let lastRecoveryAt = 0;
  let lastPlayAttemptTime = -1;
  let stallTicks = 0;

  const extractArtwork = () => {
    const mediaArtwork = navigator.mediaSession?.metadata?.artwork;
    if (Array.isArray(mediaArtwork) && mediaArtwork.length > 0) {
      const best = mediaArtwork[mediaArtwork.length - 1];
      if (best?.src) return best.src;
    }
    const imgEl = document.querySelector('ytmusic-player-bar img.image');
    return imgEl?.src || '';
  };

  const dismissIdlePromptAndRecover = () => {
    // 1. Auto-confirm YouTube Music "Are you still watching?" pause prompt
    const confirmBtn =
      document.querySelector('ytmusic-you-there-renderer yt-button-renderer button') ||
      document.querySelector('tp-yt-paper-dialog yt-confirm-dialog-renderer #confirm-button button');
    if (confirmBtn && confirmBtn.offsetParent !== null) {
      confirmBtn.click();
    }

    // 2. Auto-recover transient playback errors without looping
    const now = Date.now();
    if (now - lastRecoveryAt < 15000) return;

    const videoEl = document.querySelector('video');
    const errorOverlay = document.querySelector('yt-player-error-message-renderer');
    const hasVisibleError = Boolean(
      (videoEl && videoEl.error) ||
      (errorOverlay && errorOverlay.offsetParent !== null && (errorOverlay.textContent || '').trim().length > 0)
    );

    if (hasVisibleError) {
      lastRecoveryAt = now;
      const playBtn = document.querySelector('#play-pause-button');
      if (videoEl && videoEl.src) {
        const resumeAt = Number.isFinite(videoEl.currentTime) ? videoEl.currentTime : 0;
        videoEl.load();
        if (resumeAt > 2) {
          try { videoEl.currentTime = resumeAt; } catch (_) {}
        }
        videoEl.play().catch(() => {
          playBtn?.click();
        });
      } else {
        playBtn?.click();
      }
      return;
    }

    // 3. Detect stalled audio buffer while playing
    if (videoEl && !videoEl.paused && !videoEl.ended && videoEl.readyState < 3) {
      if (Math.abs(videoEl.currentTime - lastPlayAttemptTime) < 0.01) {
        stallTicks += 1;
        if (stallTicks >= 6) {
          stallTicks = 0;
          lastRecoveryAt = now;
          const pos = videoEl.currentTime;
          try {
            videoEl.currentTime = Math.max(0, pos + 0.1);
            videoEl.play().catch(() => {});
          } catch (_) {}
        }
      } else {
        stallTicks = 0;
      }
      lastPlayAttemptTime = videoEl.currentTime;
    } else {
      stallTicks = 0;
    }
  };

  const pollTrackState = () => {
    try {
      mountNativeNavBar();
      dismissIdlePromptAndRecover();

      const titleEl = document.querySelector('ytmusic-player-bar .title');
      const bylineEl = document.querySelector('ytmusic-player-bar .byline');
      const videoEl = document.querySelector('video');
      const title = titleEl?.textContent?.trim() || navigator.mediaSession?.metadata?.title || '';
      const artist = bylineEl?.textContent?.trim() || navigator.mediaSession?.metadata?.artist || '';
      const artwork = extractArtwork();
      const playing = Boolean(videoEl && !videoEl.paused && !videoEl.ended);
      const currentTime = videoEl && Number.isFinite(videoEl.currentTime) ? videoEl.currentTime : 0;
      const duration = videoEl && Number.isFinite(videoEl.duration) ? videoEl.duration : 0;
      const volume = videoEl ? Math.round((videoEl.volume ?? 1) * 100) : 100;
      const muted = Boolean(videoEl && (videoEl.muted || videoEl.volume === 0));

      const snapshot = \`\${title}|\${artist}|\${artwork}|\${playing}|\${Math.floor(currentTime)}|\${Math.floor(duration)}|\${volume}|\${muted}\`;
      if (snapshot !== lastSnapshot) {
        lastSnapshot = snapshot;
        ipcRenderer.send('ytm:track-update', {
          title: title || '未在播放',
          artist: artist || 'YouTube Music',
          artwork,
          playing,
          currentTime,
          duration,
          volume,
          muted,
        });
      }
    } catch (_) {}
  };

  setInterval(pollTrackState, 1000);
});
`,
  });

  files.push({
    path: 'macos-electron/src/tray-preload.js',
    target: 'macos',
    language: 'javascript',
    description: 'macOS 顶部状态栏迷你播放器安全 Preload 桥接',
    content: `const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ytmTrayBridge', {
  onState(callback) {
    ipcRenderer.on('ytm:tray-state', (_event, state) => callback(state));
  },
  sendCommand(action, value) {
    ipcRenderer.send('ytm:tray-command', { action, value });
  },
});
`,
  });

  files.push({
    path: 'macos-electron/src/tray.html',
    target: 'macos',
    language: 'html',
    description: 'macOS 顶部状态栏下拉迷你播放器（专辑封面、进度条、切歌与音量控制）',
    content: `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>${escapeXml(safeAppName)} Mini Player</title>
    <style>
      * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
        user-select: none;
      }
      html, body {
        width: 320px;
        height: 214px;
        overflow: hidden;
        background: transparent;
        font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", sans-serif;
        color: #f4f4f5;
      }
      .card {
        width: 100%;
        height: 100%;
        padding: 14px;
        border-radius: 14px;
        background: rgba(18, 19, 24, 0.92);
        border: 1px solid rgba(255, 255, 255, 0.12);
        display: flex;
        flex-direction: column;
        justify-content: space-between;
      }
      .header {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .cover-wrap {
        width: 56px;
        height: 56px;
        border-radius: 10px;
        overflow: hidden;
        background: #1f222c;
        border: 1px solid rgba(255, 255, 255, 0.08);
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .cover-wrap img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: none;
      }
      .cover-placeholder {
        font-size: 22px;
        color: #71717a;
      }
      .meta {
        flex: 1;
        min-width: 0;
      }
      .title {
        font-size: 13px;
        font-weight: 600;
        color: #ffffff;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .artist {
        margin-top: 3px;
        font-size: 11px;
        color: #a1a1aa;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .open-btn {
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.06);
        color: #e4e4e7;
        font-size: 11px;
        padding: 4px 8px;
        border-radius: 6px;
        cursor: pointer;
        flex-shrink: 0;
      }
      .open-btn:hover {
        background: rgba(255, 255, 255, 0.14);
      }
      .progress-section {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .progress-track {
        height: 5px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.14);
        cursor: pointer;
        overflow: hidden;
      }
      .progress-fill {
        height: 100%;
        width: 0%;
        background: #ff0033;
        border-radius: 999px;
        transition: width 250ms linear;
      }
      .time-row {
        display: flex;
        justify-content: space-between;
        font-size: 10px;
        font-variant-numeric: tabular-nums;
        color: #71717a;
      }
      .controls {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 18px;
      }
      .ctrl-btn {
        border: none;
        background: transparent;
        color: #e4e4e7;
        width: 34px;
        height: 34px;
        border-radius: 999px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        font-size: 15px;
        transition: background 120ms ease, transform 100ms ease;
      }
      .ctrl-btn:hover {
        background: rgba(255, 255, 255, 0.12);
      }
      .ctrl-btn.primary {
        width: 40px;
        height: 40px;
        background: #ff0033;
        color: #ffffff;
        font-size: 16px;
      }
      .ctrl-btn.primary:hover {
        background: #e0002d;
      }
      .volume-row {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .mute-btn {
        border: none;
        background: transparent;
        color: #a1a1aa;
        width: 24px;
        height: 24px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 13px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      .mute-btn:hover {
        color: #ffffff;
        background: rgba(255, 255, 255, 0.1);
      }
      input[type="range"] {
        flex: 1;
        accent-color: #ff0033;
        height: 4px;
        cursor: pointer;
      }
      .vol-value {
        width: 32px;
        text-align: right;
        font-size: 11px;
        font-variant-numeric: tabular-nums;
        color: #a1a1aa;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="header">
        <div class="cover-wrap">
          <img id="coverImg" alt="专辑封面" />
          <span id="coverPlaceholder" class="cover-placeholder">♪</span>
        </div>
        <div class="meta">
          <div id="trackTitle" class="title">未在播放</div>
          <div id="trackArtist" class="artist">${escapeXml(safeAppName)}</div>
        </div>
        <button id="openMainBtn" class="open-btn" title="打开主窗口">展开</button>
      </div>

      <div class="progress-section">
        <div id="progressTrack" class="progress-track" title="点击跳转进度">
          <div id="progressFill" class="progress-fill"></div>
        </div>
        <div class="time-row">
          <span id="currentTimeLabel">0:00</span>
          <span id="durationLabel">0:00</span>
        </div>
      </div>

      <div class="controls">
        <button id="prevBtn" class="ctrl-btn" title="上一首">⏮</button>
        <button id="playBtn" class="ctrl-btn primary" title="播放/暂停">▶</button>
        <button id="nextBtn" class="ctrl-btn" title="下一首">⏭</button>
      </div>

      <div class="volume-row">
        <button id="muteBtn" class="mute-btn" title="静音/取消静音">🔊</button>
        <input id="volumeSlider" type="range" min="0" max="100" value="100" aria-label="音量控制" />
        <span id="volumeLabel" class="vol-value">100%</span>
      </div>
    </div>

    <script>
      const coverImg = document.getElementById('coverImg');
      const coverPlaceholder = document.getElementById('coverPlaceholder');
      const trackTitle = document.getElementById('trackTitle');
      const trackArtist = document.getElementById('trackArtist');
      const progressTrack = document.getElementById('progressTrack');
      const progressFill = document.getElementById('progressFill');
      const currentTimeLabel = document.getElementById('currentTimeLabel');
      const durationLabel = document.getElementById('durationLabel');
      const prevBtn = document.getElementById('prevBtn');
      const playBtn = document.getElementById('playBtn');
      const nextBtn = document.getElementById('nextBtn');
      const muteBtn = document.getElementById('muteBtn');
      const volumeSlider = document.getElementById('volumeSlider');
      const volumeLabel = document.getElementById('volumeLabel');
      const openMainBtn = document.getElementById('openMainBtn');

      let isDraggingVolume = false;

      function fmt(sec) {
        const s = Math.max(0, Math.floor(sec || 0));
        const m = Math.floor(s / 60);
        const r = s % 60;
        return m + ':' + (r < 10 ? '0' + r : r);
      }

      prevBtn.addEventListener('click', () => window.ytmTrayBridge.sendCommand('previous'));
      playBtn.addEventListener('click', () => window.ytmTrayBridge.sendCommand('toggle'));
      nextBtn.addEventListener('click', () => window.ytmTrayBridge.sendCommand('next'));
      muteBtn.addEventListener('click', () => window.ytmTrayBridge.sendCommand('toggleMute'));
      openMainBtn.addEventListener('click', () => window.ytmTrayBridge.sendCommand('showMain'));

      progressTrack.addEventListener('click', (e) => {
        const rect = progressTrack.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        window.ytmTrayBridge.sendCommand('seek', ratio);
      });

      volumeSlider.addEventListener('pointerdown', () => { isDraggingVolume = true; });
      window.addEventListener('pointerup', () => { isDraggingVolume = false; });
      volumeSlider.addEventListener('input', () => {
        const val = Number(volumeSlider.value);
        volumeLabel.textContent = val + '%';
        muteBtn.textContent = val === 0 ? '🔇' : val < 50 ? '🔉' : '🔊';
        window.ytmTrayBridge.sendCommand('volume', val);
      });

      window.ytmTrayBridge.onState((state) => {
        if (!state) return;
        trackTitle.textContent = state.title || '未在播放';
        trackArtist.textContent = state.artist || 'YouTube Music';
        playBtn.textContent = state.playing ? '⏸' : '▶';

        if (state.artwork) {
          if (coverImg.src !== state.artwork) coverImg.src = state.artwork;
          coverImg.style.display = 'block';
          coverPlaceholder.style.display = 'none';
        } else {
          coverImg.style.display = 'none';
          coverPlaceholder.style.display = 'block';
        }

        const dur = Number(state.duration) || 0;
        const cur = Number(state.currentTime) || 0;
        const pct = dur > 0 ? Math.max(0, Math.min(100, (cur / dur) * 100)) : 0;
        progressFill.style.width = pct + '%';
        currentTimeLabel.textContent = fmt(cur);
        durationLabel.textContent = fmt(dur);

        if (!isDraggingVolume) {
          const vol = state.muted ? 0 : (Number.isFinite(state.volume) ? state.volume : 100);
          volumeSlider.value = String(vol);
          volumeLabel.textContent = vol + '%';
          muteBtn.textContent = vol === 0 ? '🔇' : vol < 50 ? '🔉' : '🔊';
        }
      });
    </script>
  </body>
</html>
`,
  });

  files.push({
    path: 'macos-electron/src/inject.css',
    target: 'macos',
    language: 'css',
    description: '注入 music.youtube.com 的 macOS 标题栏拖拽区域（为原生返回按钮留出空间）与界面净化样式',
    content: `/* macOS Native Window Integration */
${
  config.macHiddenTitlebar
    ? `ytmusic-nav-bar {
  -webkit-app-region: drag;
  padding-left: 204px !important;
}

ytmusic-nav-bar a,
ytmusic-nav-bar button,
ytmusic-nav-bar input,
ytmusic-search-box,
ytmusic-settings-button {
  -webkit-app-region: no-drag;
}
`
    : `ytmusic-nav-bar {
  padding-left: 138px !important;
}
`
}${
  config.hideUpgradeBanner
    ? `
/* Hide redundant upgrade / get-app prompts inside native desktop wrapper */
ytmusic-mealbar-promo-renderer,
ytmusic-pivot-bar-item-renderer[tab-id="SPunlimited"],
tp-yt-paper-dialog:has(ytmusic-upsell-dialog-renderer) {
  display: none !important;
}
`
    : ''
}
/* Refined dark scrollbar */
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 4px;
}
`,
  });

  files.push({
    path: 'macos-electron/build-mac.sh',
    target: 'macos',
    language: 'bash',
    executable: true,
    description: 'macOS 本机一键构建 .dmg 脚本',
    content: `#!/usr/bin/env bash
set -euo pipefail

echo "==> 正在构建 ${safeAppName} macOS (.dmg) 客户端..."
if ! command -v node >/dev/null 2>&1; then
  echo "错误：未检测到 Node.js，请先安装 Node.js 20+ (https://nodejs.org)"
  exit 1
fi

npm install
npm run dist:mac

echo "==> 构建完成！.dmg 安装包位于 ./dist 目录："
ls -lh dist/*.dmg
`,
  });

  // =========================================================================
  // 2. Android Native Kotlin + WebView + ForegroundService (.apk) Project
  // =========================================================================

  files.push({
    path: 'android-webview/settings.gradle.kts',
    target: 'android',
    language: 'gradle',
    description: 'Android Gradle 工程根配置',
    content: `pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "${pkgSlug}-android"
include(":app")
`,
  });

  files.push({
    path: 'android-webview/build.gradle.kts',
    target: 'android',
    language: 'gradle',
    description: 'Android 顶层插件版本声明',
    content: `plugins {
    id("com.android.application") version "8.7.2" apply false
    id("org.jetbrains.kotlin.android") version "2.0.21" apply false
}
`,
  });

  files.push({
    path: 'android-webview/gradle.properties',
    target: 'android',
    language: 'gradle',
    description: 'Gradle 构建内存与 AndroidX 开关配置',
    content: `org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8
android.useAndroidX=true
kotlin.code.style=official
android.nonTransitiveRClass=true
`,
  });

  files.push({
    path: 'android-webview/app/build.gradle.kts',
    target: 'android',
    language: 'gradle',
    description: 'Android App 模块构建脚本（Kotlin + AndroidX Media + WebKit）',
    content: `plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "${safeBundleId}"
    compileSdk = 35

    defaultConfig {
        applicationId = "${safeBundleId}"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "${safeVersion}"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            // Sign with debug key by default for direct sideloading if release keystore is absent
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.media:media:1.7.0")
    implementation("androidx.webkit:webkit:1.12.1")
}
`,
  });

  files.push({
    path: 'android-webview/app/proguard-rules.pro',
    target: 'android',
    language: 'proguard',
    description: '保留 WebView @JavascriptInterface 桥接类不被混淆',
    content: `-keepclassmembers class ${safeBundleId}.WebAppInterface {
    @android.webkit.JavascriptInterface <methods>;
}
`,
  });

  const deepLinkIntentBlock = config.androidDeepLinks
    ? `
            <intent-filter android:autoVerify="false">
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="https" android:host="music.youtube.com" />
            </intent-filter>`
    : '';

  files.push({
    path: 'android-webview/app/src/main/AndroidManifest.xml',
    target: 'android',
    language: 'xml',
    description: 'Android 权限声明（网络、后台媒体前台服务、通知与深链）',
    content: `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
${
  config.androidBackgroundService
    ? `    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
`
    : ''
}${config.androidWakeLock ? `    <uses-permission android:name="android.permission.WAKE_LOCK" />\n` : ''}
    <application
        android:allowBackup="true"
        android:hardwareAccelerated="true"
        android:label="@string/app_name"
        android:supportsRtl="true"
        android:theme="@style/Theme.YtmNative"
        android:usesCleartextTraffic="false">

        <activity
            android:name=".MainActivity"
            android:configChanges="orientation|screenSize|screenLayout|keyboardHidden|uiMode"
            android:exported="true"
            android:launchMode="singleTask">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>${deepLinkIntentBlock}
        </activity>
${
  config.androidBackgroundService
    ? `
        <service
            android:name=".MediaPlaybackService"
            android:enabled="true"
            android:exported="false"
            android:foregroundServiceType="mediaPlayback" />`
    : ''
}
    </application>
</manifest>
`,
  });

  files.push({
    path: 'android-webview/app/src/main/res/values/strings.xml',
    target: 'android',
    language: 'xml',
    description: 'Android 应用名称资源文件',
    content: `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">${escapeXml(safeAppName)}</string>
</resources>
`,
  });

  files.push({
    path: 'android-webview/app/src/main/res/values/themes.xml',
    target: 'android',
    language: 'xml',
    description: 'Android 沉浸式深色主题（与 YouTube Music 深黑界面一致）',
    content: `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="Theme.YtmNative" parent="Theme.AppCompat.DayNight.NoActionBar">
        <item name="android:statusBarColor">#030303</item>
        <item name="android:navigationBarColor">#030303</item>
        <item name="android:windowBackground">#030303</item>
    </style>
</resources>
`,
  });

  files.push({
    path: `android-webview/app/src/main/java/${pkgPath}/MainActivity.kt`,
    target: 'android',
    language: 'kotlin',
    description: 'Android 主界面：防播放中断/DRM 授权、外链隔离与返回导航条、Firefox 登录兼容及后台音频保活',
    content: `package ${safeBundleId}

import android.Manifest
import android.annotation.SuppressLint
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewFeature

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var floatingNavBar: LinearLayout
    private lateinit var cookieFallbackButton: Button
    private val startUrl = ${JSON.stringify(safeStartUrl)}
    private val sanitizeUa = ${config.sanitizeUserAgent}

    // Firefox Android UA bypasses Chromium/WebView attestation checks on accounts.google.com
    private val firefoxAndroidUa =
        "Mozilla/5.0 (Android 14; Mobile; rv:132.0) Gecko/132.0 Firefox/132.0"
    private val chromeAndroidUa =
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.107 Mobile Safari/537.36"

    private val mediaControlReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            val command = intent?.getStringExtra(MediaPlaybackService.EXTRA_COMMAND) ?: return
            dispatchJsPlaybackCommand(command)
        }
    }

    private fun isGoogleAuthHost(host: String): Boolean {
        val h = host.lowercase()
        return h == "accounts.google.com" ||
            h == "accounts.youtube.com" ||
            h == "gds.google.com" ||
            h == "myaccount.google.com" ||
            h == "consent.youtube.com" ||
            h == "consent.google.com"
    }

    private fun isAllowedInAppHost(host: String): Boolean {
        val h = host.lowercase()
        return h == "music.youtube.com" || isGoogleAuthHost(h)
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        requestNotificationPermissionIfNeeded()

        val root = FrameLayout(this).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(Color.parseColor("#030303"))
        }

        webView = WebView(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(Color.parseColor("#030303"))
        }
        root.addView(webView)

        // Floating Back / Home bar shown automatically whenever outside music.youtube.com
        floatingNavBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(Color.parseColor("#E6121318"))
            setPadding(16, 10, 16, 10)
            visibility = View.GONE
        }

        val backBtn = Button(this).apply {
            text = "← 返回"
            textSize = 12f
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.parseColor("#33FFFFFF"))
            setPadding(24, 8, 24, 8)
            setOnClickListener {
                if (webView.canGoBack()) webView.goBack() else loadMusicHome()
            }
        }
        val homeBtn = Button(this).apply {
            text = "⌂ 音乐首页"
            textSize = 12f
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.parseColor("#FF0033"))
            setPadding(24, 8, 24, 8)
            setOnClickListener { loadMusicHome() }
        }
        cookieFallbackButton = Button(this).apply {
            text = "粘贴 Cookie"
            textSize = 12f
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.parseColor("#33FFFFFF"))
            setPadding(24, 8, 24, 8)
            visibility = View.GONE
            setOnClickListener { showCookieImportDialog() }
        }

        val spacer = {
            View(this).apply {
                layoutParams = LinearLayout.LayoutParams(12, 1)
            }
        }
        floatingNavBar.addView(backBtn)
        floatingNavBar.addView(spacer())
        floatingNavBar.addView(homeBtn)
        floatingNavBar.addView(spacer())
        floatingNavBar.addView(cookieFallbackButton)

        val navParams = FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.TOP or Gravity.CENTER_HORIZONTAL
        ).apply {
            topMargin = 36
        }
        root.addView(floatingNavBar, navParams)

        setContentView(root)

        configureWebView(webView)
        registerBackNavigation()

        val initialUrl = intent?.dataString?.takeIf { it.startsWith("https://music.youtube.com") } ?: startUrl
        webView.loadUrl(initialUrl)

        val filter = IntentFilter(MediaPlaybackService.ACTION_MEDIA_COMMAND)
        ContextCompat.registerReceiver(this, mediaControlReceiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
    }

    private fun loadMusicHome() {
        if (sanitizeUa) {
            webView.settings.userAgentString = chromeAndroidUa
        }
        webView.loadUrl(startUrl)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        val deepLink = intent.dataString
        if (!deepLink.isNullOrBlank() && deepLink.startsWith("https://music.youtube.com")) {
            if (sanitizeUa) {
                webView.settings.userAgentString = chromeAndroidUa
            }
            webView.loadUrl(deepLink)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView(view: WebView) {
        val cookieManager = CookieManager.getInstance()
        cookieManager.setAcceptCookie(${config.persistLoginSession})
        cookieManager.setAcceptThirdPartyCookies(view, ${config.persistLoginSession})

        if (sanitizeUa && WebViewFeature.isFeatureSupported(WebViewFeature.REQUESTED_WITH_HEADER_ALLOW_LIST)) {
            WebSettingsCompat.setRequestedWithHeaderOriginAllowList(view.settings, emptySet())
        }

        view.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            javaScriptCanOpenWindowsAutomatically = true
            mediaPlaybackRequiresUserGesture = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            useWideViewPort = true
            loadWithOverviewMode = true
            setSupportMultipleWindows(false)
            if (sanitizeUa) {
                userAgentString = chromeAndroidUa
            }
        }

        view.addJavascriptInterface(WebAppInterface(this), "YTMAndroidBridge")
        view.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest?) {
                val resources = request?.resources ?: return
                val allowed = resources.filter {
                    it == PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID
                }.toTypedArray()
                if (allowed.isNotEmpty()) {
                    request.grant(allowed)
                } else {
                    request.deny()
                }
            }
        }
        view.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(v: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url ?: return false
                val host = url.host.orEmpty()
                val urlStr = url.toString()

                if (!isAllowedInAppHost(host)) {
                    try {
                        startActivity(Intent(Intent.ACTION_VIEW, url))
                    } catch (_: Exception) {}
                    return true
                }

                if (sanitizeUa && v != null) {
                    if (isGoogleAuthHost(host) && v.settings.userAgentString != firefoxAndroidUa) {
                        v.settings.userAgentString = firefoxAndroidUa
                        v.loadUrl(urlStr)
                        return true
                    } else if (host.equals("music.youtube.com", ignoreCase = true) && v.settings.userAgentString != chromeAndroidUa) {
                        v.settings.userAgentString = chromeAndroidUa
                        v.loadUrl(urlStr)
                        return true
                    }
                }

                return false
            }

            override fun onPageStarted(v: WebView?, url: String?, favicon: Bitmap?) {
                super.onPageStarted(v, url, favicon)
                val host = try {
                    Uri.parse(url.orEmpty()).host.orEmpty()
                } catch (_: Exception) {
                    ""
                }
                val onMusic = host.equals("music.youtube.com", ignoreCase = true)
                floatingNavBar.visibility = if (onMusic) View.GONE else View.VISIBLE
                cookieFallbackButton.visibility = if (isGoogleAuthHost(host)) View.VISIBLE else View.GONE
            }

            override fun onPageFinished(v: WebView?, url: String?) {
                super.onPageFinished(v, url)
                CookieManager.getInstance().flush()
                injectClientEnhancements(v)
            }
        }
    }

    private fun showCookieImportDialog() {
        val input = EditText(this).apply {
            hint = "粘贴从浏览器复制的 music.youtube.com Cookie 字符串"
            minLines = 3
            maxLines = 6
        }
        AlertDialog.Builder(this)
            .setTitle("从浏览器同步登录 Cookie")
            .setMessage("如账号开启严格安全拦截，可在桌面或手机浏览器登录 music.youtube.com 后复制 Cookie 字符串粘贴到此处：")
            .setView(input)
            .setPositiveButton("导入并刷新") { _, _ ->
                val raw = input.text?.toString()?.trim().orEmpty().replace(Regex("^cookie:\\\\s*", RegexOption.IGNORE_CASE), "")
                if (raw.isBlank() || !raw.contains("=")) {
                    Toast.makeText(this, "未检测到有效的 Cookie 格式", Toast.LENGTH_SHORT).show()
                    return@setPositiveButton
                }
                val cm = CookieManager.getInstance()
                var count = 0
                raw.split(";").forEach { part ->
                    val trimmed = part.trim()
                    if (trimmed.contains("=")) {
                        cm.setCookie("https://music.youtube.com", "$trimmed; Path=/; Secure")
                        if (!trimmed.startsWith("__Host-")) {
                            cm.setCookie("https://.youtube.com", "$trimmed; Domain=.youtube.com; Path=/; Secure")
                        }
                        count += 1
                    }
                }
                cm.flush()
                loadMusicHome()
                Toast.makeText(this, "已导入 $count 条 Cookie，正在加载主页", Toast.LENGTH_SHORT).show()
            }
            .setNegativeButton("取消", null)
            .show()
    }

    private fun injectClientEnhancements(view: WebView?) {
        val hideUpsellJs = ${
          config.hideUpgradeBanner
            ? `"""
            const style = document.createElement('style');
            style.textContent = 'ytmusic-mealbar-promo-renderer, .open-in-app-banner { display: none !important; }';
            document.head.appendChild(style);
            """`
            : `""`
        }

        val bridgeJs = """
            (function() {
              if (window.__ytmNativeInstalled) return;
              window.__ytmNativeInstalled = true;
              $hideUpsellJs
              let lastKey = '';
              let lastRecovery = 0;
              setInterval(function() {
                try {
                  const confirmBtn = document.querySelector('ytmusic-you-there-renderer yt-button-renderer button');
                  if (confirmBtn && confirmBtn.offsetParent !== null) confirmBtn.click();

                  const video = document.querySelector('video, audio');
                  const now = Date.now();
                  if (video && video.error && now - lastRecovery > 15000) {
                    lastRecovery = now;
                    const pos = video.currentTime || 0;
                    video.load();
                    if (pos > 2) { try { video.currentTime = pos; } catch (_) {} }
                    video.play().catch(function(){});
                  }

                  const meta = navigator.mediaSession && navigator.mediaSession.metadata;
                  const title = (meta && meta.title) || document.title.replace(' - YouTube Music', '') || 'YouTube Music';
                  const artist = (meta && meta.artist) || 'YouTube Music Web';
                  const playing = Boolean(video && !video.paused && !video.ended);
                  const key = title + '|' + artist + '|' + playing;
                  if (key !== lastKey && window.YTMAndroidBridge) {
                    lastKey = key;
                    window.YTMAndroidBridge.onPlaybackStateChanged(title, artist, playing);
                  }
                } catch (e) {}
              }, 1500);
            })();
        """.trimIndent()

        view?.evaluateJavascript(bridgeJs, null)
    }

    private fun dispatchJsPlaybackCommand(command: String) {
        val script = when (command) {
            "toggle" -> "(function(){ const btn = document.querySelector('#play-pause-button, .play-pause-button'); if (btn) { btn.click(); } else { const v = document.querySelector('video, audio'); if (v) v.paused ? v.play() : v.pause(); } })();"
            "next" -> "document.querySelector('.next-button')?.click();"
            "previous" -> "document.querySelector('.previous-button')?.click();"
            else -> return
        }
        webView.post { webView.evaluateJavascript(script, null) }
    }

    private fun registerBackNavigation() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) {
                    webView.goBack()
                } else {
                    moveTaskToBack(true)
                }
            }
        })
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED
            ) {
                ActivityCompat.requestPermissions(
                    this,
                    arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                    1001
                )
            }
        }
    }

    override fun onResume() {
        super.onResume()
        webView.resumeTimers()
    }

    override fun onPause() {
        super.onPause()
        CookieManager.getInstance().flush()
        // Intentionally DO NOT call webView.onPause() or pauseTimers() so audio continues in background!
    }

    override fun onDestroy() {
        unregisterReceiver(mediaControlReceiver)
        super.onDestroy()
    }
}
`,
  });

  files.push({
    path: `android-webview/app/src/main/java/${pkgPath}/WebAppInterface.kt`,
    target: 'android',
    language: 'kotlin',
    description: 'JS-to-Android 桥接：接收网页端曲目与播放状态并启动/更新前台媒体服务',
    content: `package ${safeBundleId}

import android.content.Context
import android.content.Intent
import android.webkit.JavascriptInterface
import androidx.core.content.ContextCompat

class WebAppInterface(private val context: Context) {

    @JavascriptInterface
    fun onPlaybackStateChanged(title: String, artist: String, isPlaying: Boolean) {
        ${
          config.androidBackgroundService
            ? `val serviceIntent = Intent(context, MediaPlaybackService::class.java).apply {
            action = MediaPlaybackService.ACTION_UPDATE_STATE
            putExtra(MediaPlaybackService.EXTRA_TITLE, title)
            putExtra(MediaPlaybackService.EXTRA_ARTIST, artist)
            putExtra(MediaPlaybackService.EXTRA_PLAYING, isPlaying)
        }
        ContextCompat.startForegroundService(context, serviceIntent)`
            : `// Foreground media service disabled in client configuration`
        }
    }
}
`,
  });

  files.push({
    path: `android-webview/app/src/main/java/${pkgPath}/MediaPlaybackService.kt`,
    target: 'android',
    language: 'kotlin',
    description: 'Android 前台媒体服务：息屏保活、锁屏 MediaStyle 通知栏与蓝牙耳机按键控制',
    content: `package ${safeBundleId}

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.core.app.NotificationCompat
import androidx.media.app.NotificationCompat.MediaStyle

class MediaPlaybackService : Service() {

    companion object {
        const val CHANNEL_ID = "ytm_native_playback"
        const val NOTIFICATION_ID = 7001
        const val ACTION_UPDATE_STATE = "${safeBundleId}.UPDATE_STATE"
        const val ACTION_MEDIA_COMMAND = "${safeBundleId}.MEDIA_COMMAND"
        const val EXTRA_TITLE = "title"
        const val EXTRA_ARTIST = "artist"
        const val EXTRA_PLAYING = "playing"
        const val EXTRA_COMMAND = "command"
    }

    private lateinit var mediaSession: MediaSessionCompat
    private var wakeLock: PowerManager.WakeLock? = null
    private var currentTitle = ${JSON.stringify(safeAppName)}
    private var currentArtist = "YouTube Music Web"
    private var isPlaying = false

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()

        mediaSession = MediaSessionCompat(this, "YtmNativeMediaSession").apply {
            setCallback(object : MediaSessionCompat.Callback() {
                override fun onPlay() = broadcastCommand("toggle")
                override fun onPause() = broadcastCommand("toggle")
                override fun onSkipToNext() = broadcastCommand("next")
                override fun onSkipToPrevious() = broadcastCommand("previous")
            })
            isActive = true
        }
${
  config.androidWakeLock
    ? `
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "${safeBundleId}:AudioWakeLock")
`
    : ''
}    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_UPDATE_STATE -> {
                currentTitle = intent.getStringExtra(EXTRA_TITLE) ?: currentTitle
                currentArtist = intent.getStringExtra(EXTRA_ARTIST) ?: currentArtist
                isPlaying = intent.getBooleanExtra(EXTRA_PLAYING, false)
                updateWakeLock(isPlaying)
                updateMediaSessionAndNotification()
            }
            "CMD_TOGGLE" -> broadcastCommand("toggle")
            "CMD_NEXT" -> broadcastCommand("next")
            "CMD_PREV" -> broadcastCommand("previous")
        }
        return START_STICKY
    }

    private fun updateWakeLock(playing: Boolean) {
        val lock = wakeLock ?: return
        if (playing && !lock.isHeld) {
            lock.acquire(6 * 60 * 60 * 1000L)
        } else if (!playing && lock.isHeld) {
            lock.release()
        }
    }

    private fun broadcastCommand(command: String) {
        val intent = Intent(ACTION_MEDIA_COMMAND).apply {
            setPackage(packageName)
            putExtra(EXTRA_COMMAND, command)
        }
        sendBroadcast(intent)
    }

    private fun updateMediaSessionAndNotification() {
        val playbackState = PlaybackStateCompat.Builder()
            .setActions(
                PlaybackStateCompat.ACTION_PLAY or
                    PlaybackStateCompat.ACTION_PAUSE or
                    PlaybackStateCompat.ACTION_PLAY_PAUSE or
                    PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
                    PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
            )
            .setState(
                if (isPlaying) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED,
                PlaybackStateCompat.PLAYBACK_POSITION_UNKNOWN,
                1.0f
            )
            .build()

        mediaSession.setPlaybackState(playbackState)
        mediaSession.setMetadata(
            MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE, currentTitle)
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, currentArtist)
                .build()
        )

        val notification = buildNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun buildNotification(): Notification {
        val openAppIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val prevIntent = serviceActionPendingIntent("CMD_PREV", 1)
        val toggleIntent = serviceActionPendingIntent("CMD_TOGGLE", 2)
        val nextIntent = serviceActionPendingIntent("CMD_NEXT", 3)

        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(currentTitle)
            .setContentText(currentArtist)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentIntent(openAppIntent)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(isPlaying)
            .addAction(android.R.drawable.ic_media_previous, "上一首", prevIntent)
            .addAction(
                if (isPlaying) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play,
                if (isPlaying) "暂停" else "播放",
                toggleIntent
            )
            .addAction(android.R.drawable.ic_media_next, "下一首", nextIntent)
${
  config.androidMediaNotification
    ? `            .setStyle(
                MediaStyle()
                    .setMediaSession(mediaSession.sessionToken)
                    .setShowActionsInCompactView(0, 1, 2)
            )`
    : ''
}
        return builder.build()
    }

    private fun serviceActionPendingIntent(actionName: String, requestCode: Int): PendingIntent {
        val intent = Intent(this, MediaPlaybackService::class.java).apply { action = actionName }
        return PendingIntent.getService(
            this,
            requestCode,
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "音乐后台播放控制",
                NotificationManager.IMPORTANCE_LOW
            )
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }

    override fun onDestroy() {
        wakeLock?.takeIf { it.isHeld }?.release()
        mediaSession.release()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
`,
  });

  // =========================================================================
  // 3. GitHub Actions Cloud Auto-Builder & README
  // =========================================================================

  files.push({
    path: '.github/workflows/build-clients.yml',
    target: 'ci',
    language: 'yaml',
    description: 'GitHub Actions 云端并行自动构建 macOS (.dmg) 与 Android (.apk) 并自动发布至 Releases',
    content: `name: Build ${safeAppName} (macOS DMG & Android APK)

on:
  workflow_dispatch:
  push:
    branches:
      - main
      - master

permissions:
  contents: write

jobs:
  build-macos-dmg:
    name: Build macOS (.dmg)
    runs-on: macos-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js 20
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install dependencies & package DMG
        working-directory: macos-electron
        env:
          CSC_IDENTITY_AUTO_DISCOVERY: "false"
        run: |
          npm install
          npm run dist:mac

      - name: Upload macOS DMG artifact
        uses: actions/upload-artifact@v4
        with:
          name: ${pkgSlug}-macos-dmg
          path: macos-electron/dist/*.dmg

  build-android-apk:
    name: Build Android (.apk)
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Java 17
        uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: 17

      - name: Setup Gradle 8.10.2
        uses: gradle/actions/setup-gradle@v4
        with:
          gradle-version: 8.10.2

      - name: Build Android APK
        working-directory: android-webview
        run: |
          if [ -n "\${ANDROID_HOME:-}" ] && [ -x "\$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" ]; then
            yes | "\$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --licenses >/dev/null 2>&1 || true
          fi
          gradle assembleRelease

      - name: Upload Android APK artifact
        uses: actions/upload-artifact@v4
        with:
          name: ${pkgSlug}-android-apk
          path: android-webview/app/build/outputs/apk/release/*.apk

  publish-release:
    name: Publish Direct DMG & APK Release
    needs:
      - build-macos-dmg
      - build-android-apk
    runs-on: ubuntu-latest
    steps:
      - name: Download all built binaries
        uses: actions/download-artifact@v4
        with:
          path: release-assets

      - name: Collect .dmg and .apk files
        run: |
          mkdir -p dist-release
          find release-assets -type f \\( -name "*.dmg" -o -name "*.apk" \\) -exec cp {} dist-release/ \\;
          ls -lh dist-release/

      - name: Create or update GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          tag_name: v${safeVersion}-latest
          name: "${safeAppName} v${safeVersion} (macOS .dmg + Android .apk)"
          body: "由 YTM Native Studio 自动构建发布，包含 macOS 安装镜像 (.dmg) 与 Android 安装包 (.apk)，直连官方 ${safeStartUrl} 保留完整 YouTube Premium 权益。"
          files: dist-release/*
`,
  });

  const normalizedRepo = (config.githubRepo || '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\/+$/, '');
  const repoSlug = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(normalizedRepo)
    ? normalizedRepo
    : `your-username/${pkgSlug}`;
  const repoUrl = `https://github.com/${repoSlug}`;
  const releasesUrl = `${repoUrl}/releases/latest`;
  const actionsUrl = `${repoUrl}/actions`;
  const [repoOwner, repoName] = repoSlug.split('/');
  const pagesUrl = `https://${repoOwner}.github.io/${repoName}/`;
  const currentYear = new Date().getFullYear();

  files.push({
    path: 'README.md',
    target: 'ci',
    language: 'markdown',
    description: '开源仓库主页 README（含动态徽章、特性对比、双端下载安装指南与开源协议）',
    content: `<div align="center">

# ${safeAppName}

**开源、轻量、原生体验的 YouTube Music 跨平台客户端**

直连官方 \`${safeStartUrl}\` 网页接口，完整保留 **YouTube Premium** 会员权益，为 **macOS (\`.dmg\`)** 与 **Android (\`.apk\`)** 补齐真正的桌面与移动端原生能力。

[![Latest Release](https://img.shields.io/github/v/release/${repoSlug}?display_name=tag&style=flat-square&color=FF0033&label=Release)](${releasesUrl})
[![GitHub Downloads](https://img.shields.io/github/downloads/${repoSlug}/total?style=flat-square&color=18181B&label=Downloads)](${releasesUrl})
[![Build Status](https://img.shields.io/github/actions/workflow/status/${repoSlug}/build-clients.yml?style=flat-square&label=CI%20Build)](${actionsUrl})
[![License: MIT](https://img.shields.io/badge/License-MIT-22C55E?style=flat-square)](./LICENSE)
[![Platforms](https://img.shields.io/badge/Platform-macOS%20%7C%20Android-27272A?style=flat-square)](#%E5%BF%AB%E9%80%9F%E4%B8%8B%E8%BD%BD%E4%B8%8E%E5%AE%89%E8%A3%85)

[下载最新版 (.dmg / .apk)](${releasesUrl}) · [项目下载主页](${pagesUrl}) · [云端构建状态](${actionsUrl}) · [提交反馈](${repoUrl}/issues)

</div>

---

## 为什么选择 ${safeAppName}？

浏览器自带的「安装为网页应用 (PWA)」虽然能打开 YouTube Music，但往往缺少菜单栏迷你控台、系统级后台保活、返回导航与登录防拦截。**${safeAppName}** 不依赖任何第三方破解接口，直接封装官方网页端并深度增强原生交互：

- **100% 保留 YouTube Premium 会员权益**：官方账号直登，无广告、256kbps 高音质、歌单与推荐算法实时同步；内置登录态 UA 兼容与浏览器 Cookie 一键同步兜底，解决内嵌浏览器登录风控拦截。
- **macOS 顶部状态栏迷你控台**：点击菜单栏图标即弹出磨砂深色迷你播放器，实时展示**专辑封面、可跳转进度条、上一首 / 播放暂停 / 下一首、静音与音量滑块**。
- **原生返回导航与防迷路拦截**：窗口左上角常驻**返回 / 前进 / 刷新 / 首页**原生导航条，支持 macOS 触控板双指滑动与 \`⌘[\` / \`⌘]\` 快捷键；帮助页与外部链接自动转交系统浏览器打开，永不被困在未知页面。
- **播放稳定性与后台防断流**：关闭 macOS App Nap 与后台计时器节流、放行受保护媒体流（DRM）权限、自动消除「您还在收听吗？」弹窗并在流异常时自动恢复。
- **Android 息屏保活与锁屏媒体控制**：原生 \`MediaPlaybackService\` 前台服务 + \`MediaSessionCompat\`，支持息屏后台播放、锁屏通知栏切歌与蓝牙耳机按键控制。

---

## 与浏览器 PWA 体验对比

| 核心能力 | 浏览器「安装网页应用 (PWA)」 | ${safeAppName} (macOS / Android) |
| :--- | :--- | :--- |
| YouTube Premium 会员权益与歌单同步 | 支持 | **完整保留（官方网页直连）** |
| macOS 顶部菜单栏封面 / 进度 / 音量控台 | 不支持 | **原生弹出式迷你播放器** |
| 原生返回 / 前进 / 一键回首页 & 外链隔离 | 易陷入未知页 | **常驻原生导航条 + 外链系统浏览器打开** |
| 后台长时间播放防中断 & 防休眠 | 易被浏览器节流暂停 | **PowerSaveBlocker + DRM 放行 + 自动恢复** |
| Android 息屏后台播放 & 锁屏切歌 | 切后台易被系统杀掉 | **Foreground Service + WakeLock 保活** |
| 硬件媒体键 / 蓝牙耳机控制 | 依赖浏览器焦点 | **全局原生媒体键监听** |

---

## 快速下载与安装

前往 [GitHub Releases](${releasesUrl}) 或访问 [下载主页](${pagesUrl}) 获取最新预编译安装包：

### macOS (\`.dmg\`)
1. 下载 \`${pkgSlug}-${safeVersion}-universal.dmg\`（同时支持 Apple Silicon M 系列与 Intel Mac）。
2. 双击打开 \`.dmg\`，将 **${safeAppName}** 拖入 \`Applications\`（应用程序）文件夹。
3. **首次打开提示「已损坏」或「无法验证开发者」时**（开源自签包未购买 Apple 开发者证书属正常现象），在终端执行一次解除隔离属性即可：
   \`\`\`bash
   xattr -cr "/Applications/${safeAppName}.app"
   \`\`\`
4. 登录 Google 账号：若账号开启极严格风控，可在顶部菜单栏点击 **账号 → 从剪贴板导入浏览器 Cookie 登录（备用）** 一键同步。

### Android (\`.apk\`)
1. 在 Releases 页面下载 \`app-release.apk\` 并传输至手机安装（允许「安装未知来源应用」）。
2. 首次启动请授予**通知权限**，以启用锁屏媒体卡片与息屏后台保活服务。

---

## 启用仓库专属下载主页（GitHub Pages）

本仓库已内置零依赖的静态下载官网 \`docs/index.html\`，自动拉取当前仓库的最新 Releases 资产链接：

1. 打开仓库的 **Settings → Pages**。
2. 在 **Build and deployment → Source** 选择 **Deploy from a branch**。
3. 分支选择 \`main\`，目录选择 \`/docs\`，点击 **Save**。
4. 等待约 1 分钟即可访问你的公开下载主页：\`${pagesUrl}\`。

---

## 仓库目录结构

\`\`\`text
.
├── macos-electron/                # macOS 桌面客户端 (Electron + electron-builder -> .dmg)
│   ├── src/
│   │   ├── main.js                # 主进程：防断流、状态栏弹窗、导航守卫、登录兼容
│   │   ├── preload.js             # 原生导航条注入、封面/音量同步、播放异常自动恢复
│   │   ├── tray.html              # macOS 顶部状态栏迷你播放器 UI
│   │   ├── tray-preload.js        # 迷你播放器安全 IPC 桥接
│   │   └── inject.css             # 窗口标题栏融合与界面净化样式
│   └── electron-builder.yml       # Universal / arm64 / x64 DMG 打包配置
├── android-webview/               # Android 客户端 (Kotlin + WebView + MediaSession -> .apk)
│   └── app/src/main/java/.../
│       ├── MainActivity.kt        # DRM 放行、外链隔离、返回悬浮条与 Cookie 同步
│       ├── MediaPlaybackService.kt# 前台媒体服务、锁屏通知栏与蓝牙耳机控制
│       └── WebAppInterface.kt     # 网页到 Android 原生播放状态桥接
├── docs/
│   └── index.html                 # 开源项目官网 & 自动同步 Releases 的下载落地页
├── .github/workflows/
│   └── build-clients.yml          # GitHub Actions 云端自动编译并发布 .dmg + .apk
└── LICENSE                        # MIT 开源许可证
\`\`\`

---

## 本地开发与自行编译

### macOS 本机构建 (.dmg)
\`\`\`bash
cd macos-electron
npm install
npm run dist:mac
# 产物输出路径: macos-electron/dist/*.dmg
\`\`\`

### Android 本机构建 (.apk)
\`\`\`bash
cd android-webview
gradle assembleRelease
# 产物输出路径: android-webview/app/build/outputs/apk/release/app-release.apk
\`\`\`

---

## 开源协议与免责声明

- 本项目基于 [MIT License](./LICENSE) 开源，欢迎提交 Issue 与 Pull Request。
- **免责声明**：${safeAppName} 为社区开源的第三方网页封装客户端，与 Google LLC、YouTube 或 YouTube Music 无任何官方关联。所有音频流与会员权益均直接由官方 \`music.youtube.com\` 提供，本项目不包含任何去广告破解或绕过付费逻辑。
`,
  });

  files.push({
    path: 'LICENSE',
    target: 'ci',
    language: 'markdown',
    description: '标准 MIT 开源许可证文件',
    content: `MIT License

Copyright (c) ${currentYear} ${safeAppName} Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`,
  });

  files.push({
    path: 'docs/index.html',
    target: 'ci',
    language: 'html',
    description: 'GitHub Pages 公开下载主页：自动识别系统并拉取仓库最新 Release (.dmg / .apk)',
    content: `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeXml(safeAppName)} — 开源 YouTube Music 跨平台客户端</title>
    <meta name="description" content="${escapeXml(safeAppName)} 是面向 macOS (.dmg) 与 Android (.apk) 的开源 YouTube Music 原生客户端，完整保留 YouTube Premium 会员权益。" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&family=Plus+Jakarta+Sans:wght@600;700&display=swap" rel="stylesheet" />
    <style>
      :root {
        --bg: #08090c;
        --surface: #11131a;
        --surface-hover: #171a24;
        --border: rgba(255, 255, 255, 0.08);
        --text: #f4f4f5;
        --muted: #a1a1aa;
        --dim: #71717a;
        --accent: #ff0033;
        --accent-hover: #e0002d;
      }
      * { box-sizing: border-box; margin: 0; padding: 0; }
      html { scroll-behavior: smooth; }
      body {
        background: var(--bg);
        color: var(--text);
        font-family: "DM Sans", "PingFang SC", -apple-system, sans-serif;
        line-height: 1.6;
        -webkit-font-smoothing: antialiased;
      }
      h1, h2, h3 {
        font-family: "Plus Jakarta Sans", "PingFang SC", -apple-system, sans-serif;
        letter-spacing: -0.025em;
      }
      code, .mono { font-family: "JetBrains Mono", ui-monospace, monospace; font-variant-numeric: tabular-nums; }
      a { color: inherit; text-decoration: none; }
      .container { max-width: 1120px; margin: 0 auto; padding: 0 24px; }
      header {
        position: sticky; top: 0; z-index: 40;
        background: rgba(8, 9, 12, 0.88);
        backdrop-filter: blur(14px);
        border-bottom: 1px solid var(--border);
      }
      .nav-inner {
        height: 64px;
        display: flex; align-items: center; justify-content: space-between; gap: 32px;
      }
      .brand { font-family: "Plus Jakarta Sans", sans-serif; font-size: 18px; font-weight: 700; white-space: nowrap; }
      .nav-links { display: flex; align-items: center; gap: 28px; font-size: 14px; color: var(--muted); }
      .nav-links a { white-space: nowrap; transition: color 150ms ease; }
      .nav-links a:hover { color: #fff; }
      .btn-primary {
        display: inline-flex; align-items: center; justify-content: center; gap: 8px;
        padding: 10px 20px; border-radius: 8px; font-size: 13px; font-weight: 600;
        background: var(--accent); color: #fff; border: none; cursor: pointer;
        transition: background 150ms ease; white-space: nowrap;
      }
      .btn-primary:hover { background: var(--accent-hover); }
      .btn-secondary {
        display: inline-flex; align-items: center; justify-content: center; gap: 8px;
        padding: 10px 20px; border-radius: 8px; font-size: 13px; font-weight: 500;
        background: rgba(255, 255, 255, 0.06); color: var(--text);
        border: 1px solid var(--border); cursor: pointer;
        transition: background 150ms ease; white-space: nowrap;
      }
      .btn-secondary:hover { background: rgba(255, 255, 255, 0.11); }
      .hero { padding: 84px 0 64px; }
      .kicker { font-size: 13px; color: var(--muted); display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 18px; }
      .hero h1 { font-size: clamp(2.25rem, 4.5vw, 3.6rem); line-height: 1.12; max-width: 18ch; text-wrap: balance; }
      .hero-sub { margin-top: 20px; max-width: 62ch; font-size: 16px; color: var(--muted); }
      .hero-actions { margin-top: 32px; display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
      .section { padding: 64px 0; border-top: 1px solid var(--border); }
      .section-title { font-size: 26px; margin-bottom: 10px; }
      .section-sub { font-size: 14px; color: var(--muted); margin-bottom: 32px; max-width: 64ch; }
      .download-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; }
      .card {
        background: var(--surface); border: 1px solid var(--border);
        border-radius: 14px; padding: 28px;
        display: flex; flex-direction: column; justify-content: space-between; gap: 20px;
      }
      .card-meta { font-size: 12px; color: var(--dim); margin-bottom: 8px; }
      .card h3 { font-size: 20px; margin-bottom: 8px; }
      .card p { font-size: 14px; color: var(--muted); }
      .cmd-box {
        background: #090a0e; border: 1px solid var(--border); border-radius: 8px;
        padding: 10px 14px; font-size: 12px; color: #d4d4d8;
        display: flex; align-items: center; justify-content: space-between; gap: 12px;
        overflow-x: auto;
      }
      .bento { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; }
      .span-2 { grid-column: span 2; }
      footer {
        padding: 40px 0; border-top: 1px solid var(--border);
        font-size: 13px; color: var(--dim);
        display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px;
      }
      @media (max-width: 840px) {
        .nav-links { display: none; }
        .download-grid, .bento { grid-template-columns: 1fr; }
        .span-2 { grid-column: span 1; }
      }
    </style>
  </head>
  <body>
    <header>
      <div class="container nav-inner">
        <a href="#" class="brand">${escapeXml(safeAppName)}</a>
        <nav class="nav-links">
          <a href="#download">下载客户端</a>
          <a href="#features">核心特性</a>
          <a href="${repoUrl}" target="_blank" rel="noreferrer">GitHub 源码</a>
          <a href="${releasesUrl}" target="_blank" rel="noreferrer">更新日志</a>
        </nav>
        <a id="navDownloadBtn" href="#download" class="btn-primary">立即下载</a>
      </div>
    </header>

    <main>
      <section class="hero">
        <div class="container">
          <div class="kicker">
            <span id="releaseTag">v${escapeXml(safeVersion)}</span>
            <span aria-hidden="true">·</span>
            <span>MIT 开源协议</span>
            <span aria-hidden="true">·</span>
            <span>macOS .dmg / Android .apk</span>
            <span aria-hidden="true">·</span>
            <span>直连官方网页接口</span>
          </div>
          <h1>为 YouTube Music 而生的开源原生客户端</h1>
          <p class="hero-sub">
            ${escapeXml(safeAppName)} 直接基于官方 music.youtube.com 接口打造，完整保留你的 YouTube Premium 会员权益，并补齐 macOS 顶部状态栏封面/音量控台、原生返回导航、后台防断流与 Android 息屏媒体保活。
          </p>
          <div class="hero-actions">
            <a id="heroPrimaryBtn" href="${releasesUrl}" class="btn-primary">下载最新版 (${escapeXml(safeVersion)})</a>
            <a href="${repoUrl}" target="_blank" rel="noreferrer" class="btn-secondary">查看 GitHub 仓库</a>
          </div>
        </div>
      </section>

      <section id="download" class="section">
        <div class="container">
          <h2 class="section-title">下载安装包</h2>
          <p class="section-sub">所有二进制包均由 GitHub Actions 从公开源码自动编译并发布至 Releases，欢迎随时审计源码或自行构建。</p>

          <div class="download-grid">
            <article class="card">
              <div>
                <div class="card-meta mono" id="macMeta">macOS 12+ · Apple Silicon & Intel (.dmg)</div>
                <h3>macOS 桌面客户端</h3>
                <p>包含顶部状态栏专辑封面/音量迷你控台、常驻返回导航条、触控板双指返回、硬件媒体键与防休眠保活。</p>
              </div>
              <div style="display:flex;flex-direction:column;gap:12px;">
                <a id="macDownloadBtn" href="${releasesUrl}" class="btn-primary">下载 macOS (.dmg)</a>
                <div class="cmd-box">
                  <code class="mono">xattr -cr "/Applications/${escapeXml(safeAppName)}.app"</code>
                  <button type="button" class="btn-secondary" style="padding:4px 10px;font-size:11px;" onclick="navigator.clipboard?.writeText('xattr -cr &quot;/Applications/${escapeXml(safeAppName)}.app&quot;');this.textContent='已复制';setTimeout(()=>this.textContent='复制',1500)">复制</button>
                </div>
              </div>
            </article>

            <article class="card">
              <div>
                <div class="card-meta mono" id="androidMeta">Android 8.0+ · API 26+ (.apk)</div>
                <h3>Android 移动客户端</h3>
                <p>集成原生 Foreground Service 息屏保活、锁屏 MediaStyle 通知栏切歌、DRM 音频流放行与外链防迷路导航条。</p>
              </div>
              <div style="display:flex;flex-direction:column;gap:12px;">
                <a id="androidDownloadBtn" href="${releasesUrl}" class="btn-primary">下载 Android (.apk)</a>
                <p style="font-size:12px;color:var(--dim);">安装后请授予通知权限以确保锁屏控制与后台持续播放。</p>
              </div>
            </article>
          </div>
        </div>
      </section>

      <section id="features" class="section">
        <div class="container">
          <h2 class="section-title">为什么超越浏览器 PWA</h2>
          <p class="section-sub">针对长期日常听歌中遇到的真实痛点逐项加固，而非简单套壳。</p>
          <div class="bento">
            <article class="card span-2">
              <div>
                <div class="card-meta">01. 会员权益与安全直登</div>
                <h3>完整保留 YouTube Premium 体验</h3>
                <p>不走任何第三方破解接口，官方账号直接登录。登录域名自动切换兼容 UA 并净化风控头，另提供剪贴板 Cookie 同步兜底方案。</p>
              </div>
            </article>
            <article class="card">
              <div>
                <div class="card-meta">02. 菜单栏迷你控台</div>
                <h3>专辑封面与音量随时触达</h3>
                <p>点击 macOS 顶部状态栏图标弹出迷你播放器，直接查看封面、拖拽进度、切歌并调节音量。</p>
              </div>
            </article>
            <article class="card">
              <div>
                <div class="card-meta">03. 播放防中断</div>
                <h3>后台防休眠与自动恢复</h3>
                <p>阻止 macOS App Nap 节流，放行 DRM 权限，自动确认「您还在收听吗？」弹窗并在断流时恢复播放。</p>
              </div>
            </article>
            <article class="card span-2">
              <div>
                <div class="card-meta">04. 原生导航守卫</div>
                <h3>常驻返回按钮，永不迷失在未知页面</h3>
                <p>左上角常驻返回、前进、刷新与首页按钮，支持双指滑动返回；帮助页及非音乐外链自动转交系统默认浏览器打开。</p>
              </div>
            </article>
          </div>
        </div>
      </section>
    </main>

    <footer>
      <div class="container" style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:16px;width:100%;">
        <div><strong style="color:#fff;">${escapeXml(safeAppName)}</strong> · MIT License · 独立开源项目，与 Google / YouTube 无官方关联</div>
        <div style="display:flex;gap:20px;">
          <a href="${repoUrl}" target="_blank" rel="noreferrer">GitHub</a>
          <a href="${releasesUrl}" target="_blank" rel="noreferrer">Releases</a>
          <a href="${repoUrl}/issues" target="_blank" rel="noreferrer">Issues</a>
        </div>
      </div>
    </footer>

    <script>
      (function () {
        const REPO = ${JSON.stringify(repoSlug)};
        const fallbackUrl = ${JSON.stringify(releasesUrl)};
        const ua = navigator.userAgent || '';
        const isMac = /Macintosh|Mac OS X/i.test(ua);
        const isAndroid = /Android/i.test(ua);

        function fmtSize(bytes) {
          if (!bytes) return '';
          return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
        }

        if (!REPO || REPO.startsWith('your-username/')) return;

        fetch('https://api.github.com/repos/' + REPO + '/releases/latest')
          .then((r) => (r.ok ? r.json() : null))
          .then((release) => {
            if (!release || !Array.isArray(release.assets)) return;
            const tag = release.tag_name || '';
            if (tag) document.getElementById('releaseTag').textContent = tag;

            const dmg = release.assets.find((a) => /\\.dmg$/i.test(a.name));
            const apk = release.assets.find((a) => /\\.apk$/i.test(a.name));

            if (dmg) {
              const macBtn = document.getElementById('macDownloadBtn');
              macBtn.href = dmg.browser_download_url;
              macBtn.textContent = '下载 macOS (' + fmtSize(dmg.size) + ')';
              document.getElementById('macMeta').textContent = tag + ' · ' + dmg.name;
            }
            if (apk) {
              const andBtn = document.getElementById('androidDownloadBtn');
              andBtn.href = apk.browser_download_url;
              andBtn.textContent = '下载 Android (' + fmtSize(apk.size) + ')';
              document.getElementById('androidMeta').textContent = tag + ' · ' + apk.name;
            }

            const heroBtn = document.getElementById('heroPrimaryBtn');
            const navBtn = document.getElementById('navDownloadBtn');
            if (isMac && dmg) {
              heroBtn.href = dmg.browser_download_url;
              heroBtn.textContent = '下载 macOS 版 (' + fmtSize(dmg.size) + ')';
              navBtn.href = dmg.browser_download_url;
            } else if (isAndroid && apk) {
              heroBtn.href = apk.browser_download_url;
              heroBtn.textContent = '下载 Android 版 (' + fmtSize(apk.size) + ')';
              navBtn.href = apk.browser_download_url;
            } else {
              heroBtn.href = release.html_url || fallbackUrl;
              heroBtn.textContent = '前往 Releases 下载 (' + (tag || 'Latest') + ')';
            }
          })
          .catch(() => {});
      })();
    </script>
  </body>
</html>
`,
  });

  return files;
}
