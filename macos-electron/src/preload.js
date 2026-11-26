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

window.addEventListener('DOMContentLoaded', () => {
  let lastSnapshot = '';
  let lastAccountSnapshot = '';
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

  const extractLikedState = () => {
    const likeBtn = document.querySelector(
      'ytmusic-player-bar ytmusic-like-button-renderer .like button, ytmusic-player-bar #like-button-renderer .like button'
    );
    if (!likeBtn) return false;
    return likeBtn.getAttribute('aria-pressed') === 'true';
  };

  const pollAccountState = () => {
    try {
      const signInBtn = document.querySelector('ytmusic-nav-bar a.sign-in-link');
      const avatarImg = document.querySelector(
        'ytmusic-settings-button img#img, ytmusic-settings-button img, ytmusic-nav-bar img.yt-img-shadow'
      );
      const avatarSrc = avatarImg && avatarImg.src && avatarImg.src.startsWith('http') ? avatarImg.src : '';
      const cfgLoggedIn = Boolean(
        window.ytcfg &&
        ((typeof window.ytcfg.get === 'function' && window.ytcfg.get('LOGGED_IN')) ||
          (window.ytcfg.data_ && window.ytcfg.data_.LOGGED_IN))
      );
      const loggedIn = Boolean(cfgLoggedIn || (avatarSrc && !signInBtn));
      const altName = (avatarImg?.getAttribute('alt') || '').trim();
      const name =
        altName && !/^(头像|avatar|profile|account|settings)$/i.test(altName)
          ? altName
          : loggedIn
            ? 'Google 账号已登录'
            : '';

      const accSnap = `${loggedIn}|${name}|${avatarSrc}`;
      if (accSnap !== lastAccountSnapshot) {
        lastAccountSnapshot = accSnap;
        ipcRenderer.send('ytm:account-update', {
          loggedIn,
          name,
          avatar: avatarSrc,
        });
      }
    } catch (_) {}
  };

  const dismissIdlePromptAndRecover = () => {
    const confirmBtn =
      document.querySelector('ytmusic-you-there-renderer yt-button-renderer button') ||
      document.querySelector('tp-yt-paper-dialog yt-confirm-dialog-renderer #confirm-button button');
    if (confirmBtn && confirmBtn.offsetParent !== null) {
      confirmBtn.click();
    }

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
      const liked = extractLikedState();

      const snapshot = `${title}|${artist}|${artwork}|${playing}|${Math.floor(currentTime)}|${Math.floor(duration)}|${volume}|${muted}|${liked}`;
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
          liked,
        });
      }
    } catch (_) {}
  };

  setInterval(pollTrackState, 500);
  setInterval(pollAccountState, 2000);
  setTimeout(pollAccountState, 800);
});
