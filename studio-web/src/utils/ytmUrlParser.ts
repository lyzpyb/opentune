import type { ClientConfig, ConfigValidationErrors, ParsedYtmLink } from '../types/client';

const VIDEO_ID_REGEX = /^[A-Za-z0-9_-]{11}$/;
const PLAYLIST_ID_REGEX = /^[A-Za-z0-9_-]{10,64}$/;
const BUNDLE_ID_REGEX = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,5}$/;
const SEMVER_REGEX = /^\d+\.\d+\.\d+$/;

const ALLOWED_YT_HOSTS = new Set([
  'music.youtube.com',
  'www.youtube.com',
  'youtube.com',
  'm.youtube.com',
  'youtu.be',
]);

/**
 * Parses a YouTube Music or YouTube URL into a normalized web link and official embed URL.
 */
export function parseYtmUrl(rawInput: string): ParsedYtmLink {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return {
      valid: false,
      kind: 'invalid',
      error: '请输入有效的 YouTube Music 或 YouTube 链接。',
    };
  }

  let url: URL;
  try {
    url = new URL(trimmed.startsWith('http://') || trimmed.startsWith('https://') ? trimmed : `https://${trimmed}`);
  } catch {
    return {
      valid: false,
      kind: 'invalid',
      error: '链接格式不正确，请输入完整的 URL（例如 https://music.youtube.com/watch?v=...）。',
    };
  }

  const host = url.hostname.toLowerCase();
  if (!ALLOWED_YT_HOSTS.has(host)) {
    return {
      valid: false,
      kind: 'invalid',
      error: '仅支持 music.youtube.com、youtube.com 或 youtu.be 域名下的音乐链接。',
    };
  }

  let videoId: string | undefined;
  let playlistId: string | undefined;

  if (host === 'youtu.be') {
    const candidate = url.pathname.replace(/^\/+/, '').split('/')[0];
    if (candidate && VIDEO_ID_REGEX.test(candidate)) {
      videoId = candidate;
    }
    const listParam = url.searchParams.get('list');
    if (listParam && PLAYLIST_ID_REGEX.test(listParam)) {
      playlistId = listParam;
    }
  } else {
    const vParam = url.searchParams.get('v');
    if (vParam && VIDEO_ID_REGEX.test(vParam)) {
      videoId = vParam;
    } else {
      const embedMatch = url.pathname.match(/^\/(?:embed|shorts)\/([A-Za-z0-9_-]{11})/);
      if (embedMatch) {
        videoId = embedMatch[1];
      }
    }

    const listParam = url.searchParams.get('list');
    if (listParam && PLAYLIST_ID_REGEX.test(listParam)) {
      playlistId = listParam;
    }
  }

  if (videoId) {
    const listQuery = playlistId ? `&list=${encodeURIComponent(playlistId)}` : '';
    return {
      valid: true,
      kind: 'video',
      videoId,
      playlistId,
      normalizedUrl: `https://music.youtube.com/watch?v=${videoId}${listQuery}`,
      embedUrl: `https://www.youtube.com/embed/${videoId}?autoplay=0&rel=0&modestbranding=1${listQuery}`,
    };
  }

  if (playlistId) {
    return {
      valid: true,
      kind: 'playlist',
      playlistId,
      normalizedUrl: `https://music.youtube.com/playlist?list=${playlistId}`,
      embedUrl: `https://www.youtube.com/embed/videoseries?list=${encodeURIComponent(playlistId)}`,
    };
  }

  if (host === 'music.youtube.com' && (url.pathname === '/' || url.pathname === '')) {
    return {
      valid: true,
      kind: 'home',
      normalizedUrl: 'https://music.youtube.com',
    };
  }

  return {
    valid: false,
    kind: 'invalid',
    error: '未能从该链接中解析出有效的曲目 ID（v=）或歌单 ID（list=）。',
  };
}

/**
 * Validates all user-editable client configuration fields before code/ZIP export.
 */
export function validateClientConfig(config: ClientConfig): ConfigValidationErrors {
  const errors: ConfigValidationErrors = {};

  const appName = config.appName.trim();
  if (!appName) {
    errors.appName = '应用名称不能为空。';
  } else if (appName.length > 40) {
    errors.appName = '应用名称请控制在 40 个字符以内。';
  } else if (/["'<>\\]/.test(appName)) {
    errors.appName = '应用名称不能包含引号或特殊转义字符。';
  }

  const bundleId = config.bundleId.trim();
  if (!BUNDLE_ID_REGEX.test(bundleId)) {
    errors.bundleId = '包名格式须为反向域名（如 com.custom.ytmusic），仅允许小写字母、数字与下划线。';
  }

  if (!SEMVER_REGEX.test(config.version.trim())) {
    errors.version = '版本号须符合语义化格式（例如 1.0.0）。';
  }

  try {
    const startParsed = new URL(config.startUrl.trim());
    if (startParsed.protocol !== 'https:') {
      errors.startUrl = '入口地址必须使用 https:// 协议以保障 Google 账号 Cookie 安全。';
    } else if (!startParsed.hostname.endsWith('youtube.com')) {
      errors.startUrl = '入口域名应为 music.youtube.com 或 youtube.com 子域名。';
    }
  } catch {
    errors.startUrl = '请输入有效的 HTTPS 入口链接（默认 https://music.youtube.com）。';
  }

  const proxy = config.proxyServer.trim();
  if (proxy) {
    try {
      const parsedProxy = new URL(proxy);
      if (!['http:', 'https:', 'socks5:', 'socks4:'].includes(parsedProxy.protocol)) {
        errors.proxyServer = '代理协议仅支持 http://、https:// 或 socks5://。';
      }
    } catch {
      errors.proxyServer = '代理地址格式不正确（例如 http://127.0.0.1:7890 或 socks5://127.0.0.1:1080）。';
    }
  }

  return errors;
}

export function hasValidationErrors(errors: ConfigValidationErrors): boolean {
  return Object.keys(errors).length > 0;
}

export function formatSeconds(sec: number): string {
  const clamped = Math.max(0, Math.floor(sec));
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
