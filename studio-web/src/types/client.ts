export type MacArchitecture = 'universal' | 'arm64' | 'x64';

export type WorkspaceTab = 'preview' | 'config' | 'source' | 'github' | 'guide';

export type FileTargetGroup = 'macos' | 'android' | 'ci';

export interface GitHubUser {
  login: string;
  name: string | null;
  avatarUrl: string;
  htmlUrl: string;
}

export interface GitHubRepoSummary {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  private: boolean;
  defaultBranch: string;
  htmlUrl: string;
  updatedAt: string;
}

export interface GitHubArtifactItem {
  id: number;
  name: string;
  sizeInBytes: number;
  expired: boolean;
  createdAt: string;
}

export interface GitHubWorkflowRun {
  id: number;
  runNumber: number;
  status: string;
  conclusion: string | null;
  htmlUrl: string;
  headBranch: string;
  headSha: string;
  createdAt: string;
  updatedAt: string;
  artifacts: GitHubArtifactItem[];
}

export interface ClientConfig {
  appName: string;
  bundleId: string;
  version: string;
  startUrl: string;
  macArch: MacArchitecture;
  proxyServer: string;
  // YouTube Premium & Web-wrap integrity
  sanitizeUserAgent: boolean;
  persistLoginSession: boolean;
  hideUpgradeBanner: boolean;
  // macOS Native capabilities
  macMediaKeys: boolean;
  macCloseToTray: boolean;
  macHiddenTitlebar: boolean;
  // Android Native capabilities
  androidBackgroundService: boolean;
  androidMediaNotification: boolean;
  androidWakeLock: boolean;
  androidDeepLinks: boolean;
  // Open-source repository binding (owner/repo) for README badges & GitHub Pages download links
  githubRepo?: string;
}

export interface GeneratedFile {
  path: string;
  target: FileTargetGroup;
  language: 'javascript' | 'kotlin' | 'xml' | 'yaml' | 'json' | 'css' | 'html' | 'bash' | 'markdown' | 'gradle' | 'proguard';
  description: string;
  content: string;
  executable?: boolean;
}

export interface ParsedYtmLink {
  valid: boolean;
  kind: 'video' | 'playlist' | 'home' | 'invalid';
  videoId?: string;
  playlistId?: string;
  normalizedUrl?: string;
  embedUrl?: string;
  error?: string;
}

export interface ConfigValidationErrors {
  appName?: string;
  bundleId?: string;
  version?: string;
  startUrl?: string;
  proxyServer?: string;
}

export interface SampleTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: string;
  durationSec: number;
  videoId: string;
  ytmUrl: string;
  coverSrc: string;
  bitrateLabel: string;
}

export const DEFAULT_CLIENT_CONFIG: ClientConfig = {
  appName: 'OpenTune',
  bundleId: 'org.opentune.client',
  version: '1.1.0',
  startUrl: 'https://music.youtube.com',
  macArch: 'universal',
  proxyServer: '',
  sanitizeUserAgent: true,
  persistLoginSession: true,
  hideUpgradeBanner: true,
  macMediaKeys: true,
  macCloseToTray: true,
  macHiddenTitlebar: true,
  androidBackgroundService: true,
  androidMediaNotification: true,
  androidWakeLock: true,
  androidDeepLinks: true,
  githubRepo: '',
};
