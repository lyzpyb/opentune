const { contextBridge, ipcRenderer } = require('electron');

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
  hiddenTitlebar: true,
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

  shadow.innerHTML = `
    <style>
      .bar {
        position: fixed;
        top: 10px;
        left: ${latestNavState.hiddenTitlebar ? '78px' : '12px'};
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
  `;

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

      const snapshot = `${title}|${artist}|${artwork}|${playing}|${Math.floor(currentTime)}|${Math.floor(duration)}|${volume}|${muted}`;
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
