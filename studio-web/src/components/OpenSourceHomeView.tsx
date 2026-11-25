import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Check,
  Copy,
  Download,
  ExternalLink,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { ClientConfig, GeneratedFile, WorkspaceTab } from '../types/client';
import { SAMPLE_TRACKS } from '../data/sampleTracks';
import { formatBytes } from '../utils/githubHelpers';
import { formatSeconds } from '../utils/ytmUrlParser';

interface OpenSourceHomeViewProps {
  config: ClientConfig;
  generatedFiles: GeneratedFile[];
  hasConfigErrors: boolean;
  onUpdateConfig: (patch: Partial<ClientConfig>) => void;
  onOpenStudio: (tab?: WorkspaceTab) => void;
  onExportFullZip: () => void;
}

interface ReleaseAsset {
  name: string;
  size: number;
  downloadUrl: string;
}

interface LatestReleaseInfo {
  tagName: string;
  publishedAt: string;
  htmlUrl: string;
  dmgAsset: ReleaseAsset | null;
  apkAsset: ReleaseAsset | null;
}

const HERO_IMAGE_PATH = '/src/assets/images/opentune_hero_studio_1795575966100.jpg';
const CRAFT_IMAGE_PATH = '/src/assets/images/opentune_audio_craft_1795575965237.jpg';

function detectUserPlatform(): 'macos' | 'android' | 'other' {
  if (typeof navigator === 'undefined') return 'macos';
  const ua = navigator.userAgent || '';
  if (/Android/i.test(ua)) return 'android';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'macos';
  return 'other';
}

function normalizeRepoSlug(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '');
  const parts = cleaned.split('/').filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]}/${parts[1]}`;
  }
  return cleaned;
}

function isValidRepoSlug(slug: string): boolean {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(slug);
}

export function OpenSourceHomeView({
  config,
  generatedFiles,
  hasConfigErrors,
  onUpdateConfig,
  onOpenStudio,
  onExportFullZip,
}: OpenSourceHomeViewProps) {
  const platform = useMemo(() => detectUserPlatform(), []);
  const [repoDraft, setRepoDraft] = useState(config.githubRepo || '');
  const [repoError, setRepoError] = useState<string | null>(null);
  const [releaseInfo, setReleaseInfo] = useState<LatestReleaseInfo | null>(null);
  const [loadingRelease, setLoadingRelease] = useState(false);
  const [releaseFetchMessage, setReleaseFetchMessage] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [heroImgFailed, setHeroImgFailed] = useState(false);
  const [craftImgFailed, setCraftImgFailed] = useState(false);

  // Interactive macOS Menu Bar Mini-Player demonstration state
  const [trackIndex, setTrackIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [progressSec, setProgressSec] = useState(76);
  const [volume, setVolume] = useState(82);
  const [muted, setMuted] = useState(false);

  const activeTrack = SAMPLE_TRACKS[trackIndex] ?? SAMPLE_TRACKS[0];
  const appDisplayName = config.appName.trim() || 'OpenTune';
  const boundRepo = normalizeRepoSlug(config.githubRepo || '');
  const hasBoundRepo = isValidRepoSlug(boundRepo);
  const githubRepoUrl = hasBoundRepo ? `https://github.com/${boundRepo}` : null;
  const githubReleasesUrl = hasBoundRepo ? `https://github.com/${boundRepo}/releases/latest` : null;

  const readmeFile = useMemo(
    () => generatedFiles.find((f) => f.path === 'README.md'),
    [generatedFiles]
  );

  useEffect(() => {
    setRepoDraft(config.githubRepo || '');
  }, [config.githubRepo]);

  // Simulate gentle playback progress inside interactive mini-player preview
  useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setInterval(() => {
      setProgressSec((prev) => (prev + 1 >= activeTrack.durationSec ? 0 : prev + 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isPlaying, activeTrack.durationSec]);

  const [releaseNotice, setReleaseNotice] = useState<string | null>(null);

  // Fetch real GitHub latest release assets automatically from server (uses server-bound repo or config.githubRepo)
  useEffect(() => {
    let cancelled = false;
    setLoadingRelease(true);
    setReleaseFetchMessage(null);

    const query = hasBoundRepo ? `?repo=${encodeURIComponent(boundRepo)}` : '';
    fetch(`/api/releases/latest${query}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        if (typeof data.repo === 'string' && data.repo && !hasBoundRepo) {
          onUpdateConfig({ githubRepo: data.repo });
          setRepoDraft(data.repo);
        }
        if (data.found) {
          setReleaseInfo({
            tagName: data.tagName || `v${config.version}`,
            publishedAt: data.publishedAt ? new Date(data.publishedAt).toLocaleDateString('zh-CN') : '',
            htmlUrl: data.htmlUrl || (data.repo ? `https://github.com/${data.repo}/releases` : ''),
            dmgAsset: data.dmgAsset ?? null,
            apkAsset: data.apkAsset ?? null,
          });
          setReleaseNotice(null);
        } else {
          setReleaseInfo(null);
          if (data.message) setReleaseFetchMessage(data.message);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setReleaseInfo(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingRelease(false);
      });

    return () => {
      cancelled = true;
    };
  }, [boundRepo, hasBoundRepo, config.version]);

  const handleBindRepoSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = normalizeRepoSlug(repoDraft);
    if (!cleaned) {
      setRepoError(null);
      onUpdateConfig({ githubRepo: '' });
      fetch('/api/releases/bind', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: '' }),
      }).catch(() => {});
      return;
    }
    if (!isValidRepoSlug(cleaned)) {
      setRepoError('请输入有效的仓库路径，例如 username/opentune');
      return;
    }
    setRepoError(null);
    setReleaseNotice(null);
    onUpdateConfig({ githubRepo: cleaned });
    fetch('/api/releases/bind', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo: cleaned }),
    }).catch(() => {});
  };

  const handleUnboundDownloadClick = (targetLabel: string) => {
    setReleaseNotice(
      `当前尚未检测到已公开的 ${targetLabel} Release 安装包。请在上方填入你的公开 GitHub 仓库（如 yourname/opentune）同步已发布的安装包，或点击「构建工坊」推送一次代码自动产出正式 Release。`
    );
  };

  const handleCopy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId(null), 1800);
    } catch {
      // Ignore clipboard failure
    }
  };

  const handleSwitchTrack = (delta: number) => {
    setTrackIndex((prev) => (prev + delta + SAMPLE_TRACKS.length) % SAMPLE_TRACKS.length);
    setProgressSec(0);
    setIsPlaying(true);
  };

  const xattrCommand = `xattr -cr "/Applications/${appDisplayName}.app"`;
  const effectiveVolume = muted ? 0 : volume;
  const progressPct = Math.min(100, Math.max(0, (progressSec / activeTrack.durationSec) * 100));

  const primaryDownloadHref =
    platform === 'android'
      ? releaseInfo?.apkAsset?.downloadUrl || githubReleasesUrl
      : releaseInfo?.dmgAsset?.downloadUrl || githubReleasesUrl;

  const primaryDownloadLabel =
    platform === 'android'
      ? releaseInfo?.apkAsset
        ? `下载 Android 版 (${formatBytes(releaseInfo.apkAsset.size)})`
        : '下载 Android (.apk)'
      : releaseInfo?.dmgAsset
        ? `下载 macOS 版 (${formatBytes(releaseInfo.dmgAsset.size)})`
        : '下载 macOS (.dmg)';

  return (
    <div className="min-h-screen bg-[#08090C] text-[#F4F4F5] selection:bg-[#FF0033]/30">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-40 h-16 bg-[#08090C]/90 backdrop-blur-md border-b border-white/[0.08]">
        <div className="max-w-[1200px] mx-auto h-full px-6 flex items-center justify-between gap-8">
          <a
            href="#top"
            className="font-display text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0"
          >
            {appDisplayName}
          </a>

          <nav
            aria-label="主导航"
            className="hidden md:flex items-center gap-7 text-sm font-medium text-zinc-400"
          >
            <a
              href="#download"
              className="hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              下载安装包
            </a>
            <a
              href="#features"
              className="hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              核心特性
            </a>
            <a
              href="#open-source"
              className="hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              开源 README
            </a>
            <button
              type="button"
              onClick={() => onOpenStudio('github')}
              className="hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              构建工坊
            </button>
          </nav>

          <div className="flex items-center shrink-0">
            <a
              href="#download"
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#FF0033] hover:bg-[#E0002D] rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5 shrink-0" />
              <span>立即下载</span>
            </a>
          </div>
        </div>
      </header>

      <main id="top">
        {/* Section 1: Hero — Proposition + OS-Detected CTA + Editorial Hardware Showcase */}
        <section className="max-w-[1200px] mx-auto px-6 pt-16 pb-20 lg:pt-24 lg:pb-24">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-stretch">
            <div className="lg:col-span-6 flex flex-col justify-center">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-zinc-400 font-mono tabular-nums mb-5">
                <span>{releaseInfo?.tagName || `v${config.version}`}</span>
                <span aria-hidden="true">·</span>
                <span>MIT 开源协议</span>
                <span aria-hidden="true">·</span>
                <span>macOS .dmg / Android .apk</span>
                <span aria-hidden="true">·</span>
                <span>直连官方网页接口</span>
              </div>

              <h1
                className="font-display font-bold tracking-tight text-white leading-[1.1] max-w-[16ch]"
                style={{ fontSize: 'clamp(2.25rem, 4.2vw, 3.6rem)', textWrap: 'balance' }}
              >
                为 YouTube Music 而生的开源原生客户端
              </h1>

              <p className="mt-5 text-[15px] sm:text-base text-zinc-400 leading-relaxed max-w-[54ch]">
                {appDisplayName} 直接封装官方 <span className="font-mono text-zinc-200">music.youtube.com</span> 网页接口，完整保留你的 YouTube Premium 会员权益，并补齐 macOS 顶部状态栏封面与音量控台、原生返回导航、后台防断流以及 Android 息屏媒体保活。
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                {primaryDownloadHref ? (
                  <a
                    href={primaryDownloadHref}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-[#FF0033] hover:bg-[#E0002D] rounded-lg transition-colors whitespace-nowrap"
                  >
                    <Download className="w-4 h-4 shrink-0" />
                    <span>{primaryDownloadLabel}</span>
                  </a>
                ) : (
                  <a
                    href="#download"
                    className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-[#FF0033] hover:bg-[#E0002D] rounded-lg transition-colors whitespace-nowrap"
                  >
                    <Download className="w-4 h-4 shrink-0" />
                    <span>{primaryDownloadLabel}</span>
                  </a>
                )}

                {githubRepoUrl ? (
                  <a
                    href={githubRepoUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-zinc-200 bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.1] rounded-lg transition-colors whitespace-nowrap"
                  >
                    <span>查看 GitHub 源码</span>
                    <ExternalLink className="w-4 h-4 shrink-0" />
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={() => onOpenStudio('github')}
                    className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-zinc-200 bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.1] rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <span>打开构建工坊</span>
                    <ArrowRight className="w-4 h-4 shrink-0" />
                  </button>
                )}
              </div>

              <div className="mt-8 pt-6 border-t border-white/[0.08] flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-zinc-500">
                <span>零第三方破解接口</span>
                <span>账号 Cookie 仅存本机</span>
                <span>GitHub Actions 透明编译</span>
              </div>
            </div>

            {/* Right Visual Carrier: Editorial Hardware Photography + Live Interactive Menu Bar Popover */}
            <div className="lg:col-span-6 flex flex-col">
              <div className="relative flex-1 min-h-[360px] rounded-2xl overflow-hidden border border-white/[0.09] bg-[#11131A]">
                {!heroImgFailed ? (
                  <img
                    src={HERO_IMAGE_PATH}
                    alt={`${appDisplayName} 桌面与移动音频工作台`}
                    referrerPolicy="no-referrer"
                    onError={() => setHeroImgFailed(true)}
                    className="w-full h-full object-cover opacity-85"
                  />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-[#161822] via-[#101219] to-[#08090C]" />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-[#08090C]/95 via-[#08090C]/35 to-[#08090C]/20" />

                {/* Interactive macOS Top Menu Bar Mini-Player Preview anchored cleanly */}
                <div className="absolute inset-x-4 bottom-4 sm:inset-x-6 sm:bottom-6 rounded-xl bg-[#11131A]/95 backdrop-blur-md border border-white/[0.12] p-4">
                  <div className="flex items-center justify-between gap-2 pb-3 mb-3 border-b border-white/[0.07] text-[11px] text-zinc-400">
                    <span className="font-medium text-zinc-200">macOS 顶部状态栏控台实时体验</span>
                    <span className="font-mono tabular-nums text-zinc-500">{activeTrack.bitrateLabel}</span>
                  </div>

                  <div className="flex items-center gap-3.5">
                    <img
                      src={activeTrack.coverSrc}
                      alt={activeTrack.title}
                      referrerPolicy="no-referrer"
                      className="w-12 h-12 rounded-lg object-cover border border-white/[0.1] shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-white truncate">
                        {activeTrack.title}
                      </div>
                      <div className="text-xs text-zinc-400 truncate mt-0.5">
                        {activeTrack.artist}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleSwitchTrack(-1)}
                        aria-label="上一首"
                        className="w-8 h-8 rounded-full flex items-center justify-center text-zinc-300 hover:bg-white/[0.1] hover:text-white transition-colors cursor-pointer"
                      >
                        <SkipBack className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsPlaying((p) => !p)}
                        aria-label={isPlaying ? '暂停播放' : '开始播放'}
                        className="w-9 h-9 rounded-full flex items-center justify-center bg-[#FF0033] hover:bg-[#E0002D] text-white transition-colors cursor-pointer"
                      >
                        {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSwitchTrack(1)}
                        aria-label="下一首"
                        className="w-8 h-8 rounded-full flex items-center justify-center text-zinc-300 hover:bg-white/[0.1] hover:text-white transition-colors cursor-pointer"
                      >
                        <SkipForward className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Interactive Seek Bar & Volume Slider */}
                  <div className="mt-3.5 space-y-2.5">
                    <div>
                      <button
                        type="button"
                        aria-label="点击调整试听进度"
                        onClick={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                          setProgressSec(Math.round(activeTrack.durationSec * ratio));
                        }}
                        className="w-full h-1.5 rounded-full bg-white/[0.12] overflow-hidden block cursor-pointer"
                      >
                        <span
                          className="block h-full bg-[#FF0033] rounded-full transition-[width] duration-200"
                          style={{ width: `${progressPct}%` }}
                        />
                      </button>
                      <div className="mt-1 flex items-center justify-between text-[11px] font-mono tabular-nums text-zinc-500">
                        <span>{formatSeconds(progressSec)}</span>
                        <span>{activeTrack.duration}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2.5">
                      <button
                        type="button"
                        onClick={() => setMuted((m) => !m)}
                        aria-label={muted ? '取消静音' : '静音'}
                        className="text-zinc-400 hover:text-white transition-colors cursor-pointer"
                      >
                        {effectiveVolume === 0 ? (
                          <VolumeX className="w-4 h-4" />
                        ) : (
                          <Volume2 className="w-4 h-4" />
                        )}
                      </button>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={effectiveVolume}
                        aria-label="调节演示音量"
                        onChange={(e) => {
                          const next = Number(e.target.value);
                          setVolume(next);
                          setMuted(next === 0);
                        }}
                        className="flex-1 h-1 accent-[#FF0033] cursor-pointer"
                      />
                      <span className="w-9 text-right text-[11px] font-mono tabular-nums text-zinc-400">
                        {effectiveVolume}%
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Section 2: Platform Download Matrix + Auto-Synced GitHub Releases */}
        <section id="download" className="border-t border-white/[0.08] py-20">
          <div className="max-w-[1200px] mx-auto px-6">
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 mb-10">
              <div>
                <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-white">
                  下载 {appDisplayName} 客户端
                </h2>
                <p className="mt-2 text-sm text-zinc-400 max-w-[60ch]">
                  安装包由 GitHub Actions 自动编译并发布至 GitHub Releases，页面会自动读取最新版本的 <span className="font-mono text-zinc-200">.dmg</span> 与 <span className="font-mono text-zinc-200">.apk</span> 直链供所有访客直接下载。
                </p>
              </div>

              <form onSubmit={handleBindRepoSubmit} className="flex flex-col sm:flex-row gap-2.5 shrink-0">
                <div>
                  <label htmlFor="github-repo-bind" className="sr-only">
                    关联开源仓库 (owner/repo)
                  </label>
                  <input
                    id="github-repo-bind"
                    type="text"
                    value={repoDraft}
                    onChange={(e) => setRepoDraft(e.target.value)}
                    placeholder="关联仓库，如 yourname/opentune"
                    className="w-full sm:w-64 px-3.5 py-2 text-xs font-mono text-white bg-[#11131A] border border-white/[0.12] rounded-lg focus:outline-none focus:border-[#FF0033]"
                  />
                </div>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-medium text-white bg-white/[0.08] hover:bg-white/[0.14] border border-white/[0.1] rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                >
                  {loadingRelease ? '同步中…' : '保存并同步'}
                </button>
              </form>
            </div>

            {repoError && (
              <p className="mb-6 text-xs text-amber-400" role="alert">
                {repoError}
              </p>
            )}
            {releaseFetchMessage && (
              <p className="mb-6 text-xs text-zinc-400">
                仓库 <span className="font-mono text-zinc-200">{boundRepo}</span>：{releaseFetchMessage}
              </p>
            )}
            {releaseNotice && (
              <div
                role="status"
                className="mb-6 px-4 py-3 rounded-lg bg-white/[0.04] border border-white/[0.1] text-xs text-zinc-300 flex flex-wrap items-center justify-between gap-3"
              >
                <span>{releaseNotice}</span>
                <button
                  type="button"
                  onClick={() => onOpenStudio('github')}
                  className="text-[#FF0033] hover:text-white font-medium underline underline-offset-4 shrink-0 cursor-pointer"
                >
                  前往构建工坊推送发版
                </button>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* macOS .dmg Card */}
              <article className="rounded-2xl bg-[#11131A] border border-white/[0.08] p-7 flex flex-col justify-between gap-6">
                <div>
                  <div className="text-xs font-mono text-zinc-500 tabular-nums mb-2">
                    {releaseInfo?.dmgAsset
                      ? `${releaseInfo.tagName} · ${releaseInfo.dmgAsset.name} · ${formatBytes(releaseInfo.dmgAsset.size)}`
                      : `v${config.version} · macOS 12+ · Apple Silicon & Intel (${config.macArch})`}
                  </div>
                  <h3 className="font-display text-xl font-semibold text-white">
                    macOS 桌面端 (.dmg)
                  </h3>
                  <p className="mt-2 text-sm text-zinc-400 leading-relaxed">
                    原生 Electron 架构，集成顶部状态栏封面/进度/音量迷你控台、左上角常驻返回导航条、触控板双指返回、硬件媒体键以及防休眠后台保活。
                  </p>
                </div>

                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-3">
                    {releaseInfo?.dmgAsset ? (
                      <a
                        href={releaseInfo.dmgAsset.downloadUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-[#FF0033] hover:bg-[#E0002D] rounded-lg transition-colors whitespace-nowrap"
                      >
                        <Download className="w-3.5 h-3.5 shrink-0" />
                        <span>下载 macOS (.dmg · {formatBytes(releaseInfo.dmgAsset.size)})</span>
                      </a>
                    ) : githubReleasesUrl ? (
                      <a
                        href={githubReleasesUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-[#FF0033] hover:bg-[#E0002D] rounded-lg transition-colors whitespace-nowrap"
                      >
                        <Download className="w-3.5 h-3.5 shrink-0" />
                        <span>下载 macOS (.dmg)</span>
                      </a>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleUnboundDownloadClick('macOS (.dmg)')}
                        className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-[#FF0033] hover:bg-[#E0002D] rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5 shrink-0" />
                        <span>下载 macOS (.dmg)</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => onOpenStudio('source')}
                      className="text-xs text-zinc-400 hover:text-white underline underline-offset-4 transition-colors cursor-pointer"
                    >
                      查看 macOS 源码
                    </button>
                  </div>

                  {/* Gatekeeper copyable command */}
                  <div className="rounded-lg bg-[#090A0E] border border-white/[0.07] px-3.5 py-2.5 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[11px] text-zinc-500 mb-0.5">
                        首次安装如提示「无法验证开发者」，终端运行一次解除隔离：
                      </div>
                      <code className="text-xs font-mono text-zinc-200 block truncate">
                        {xattrCommand}
                      </code>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCopy('xattr', xattrCommand)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-zinc-300 bg-white/[0.06] hover:bg-white/[0.12] rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      {copiedId === 'xattr' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      <span>{copiedId === 'xattr' ? '已复制' : '复制'}</span>
                    </button>
                  </div>
                </div>
              </article>

              {/* Android .apk Card */}
              <article className="rounded-2xl bg-[#11131A] border border-white/[0.08] p-7 flex flex-col justify-between gap-6">
                <div>
                  <div className="text-xs font-mono text-zinc-500 tabular-nums mb-2">
                    {releaseInfo?.apkAsset
                      ? `${releaseInfo.tagName} · ${releaseInfo.apkAsset.name} · ${formatBytes(releaseInfo.apkAsset.size)}`
                      : `v${config.version} · Android 8.0+ · API 26–35 · Kotlin + MediaSession`}
                  </div>
                  <h3 className="font-display text-xl font-semibold text-white">
                    Android 移动端 (.apk)
                  </h3>
                  <p className="mt-2 text-sm text-zinc-400 leading-relaxed">
                    基于系统 WebView 与原生 Foreground Service 媒体前台服务，支持息屏连续播放、锁屏媒体卡片切歌、蓝牙耳机控制、DRM 流放行与离开主页返回悬浮条。
                  </p>
                </div>

                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-3">
                    {releaseInfo?.apkAsset ? (
                      <a
                        href={releaseInfo.apkAsset.downloadUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-white/[0.1] hover:bg-white/[0.16] border border-white/[0.12] rounded-lg transition-colors whitespace-nowrap"
                      >
                        <Download className="w-3.5 h-3.5 shrink-0" />
                        <span>下载 Android (.apk · {formatBytes(releaseInfo.apkAsset.size)})</span>
                      </a>
                    ) : githubReleasesUrl ? (
                      <a
                        href={githubReleasesUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-white/[0.1] hover:bg-white/[0.16] border border-white/[0.12] rounded-lg transition-colors whitespace-nowrap"
                      >
                        <Download className="w-3.5 h-3.5 shrink-0" />
                        <span>下载 Android (.apk)</span>
                      </a>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleUnboundDownloadClick('Android (.apk)')}
                        className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-white/[0.1] hover:bg-white/[0.16] border border-white/[0.12] rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5 shrink-0" />
                        <span>下载 Android (.apk)</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => onOpenStudio('source')}
                      className="text-xs text-zinc-400 hover:text-white underline underline-offset-4 transition-colors cursor-pointer"
                    >
                      查看 Android 源码
                    </button>
                  </div>

                  <div className="rounded-lg bg-[#090A0E] border border-white/[0.07] px-3.5 py-2.5 text-xs text-zinc-400">
                    安装后请允许「通知权限」并在系统电池设置中设为不限制后台，即可获得稳定的息屏播放与锁屏切歌体验。
                  </div>
                </div>
              </article>
            </div>
          </div>
        </section>

        {/* Section 3: Asymmetric Bento Capabilities Grid */}
        <section id="features" className="border-t border-white/[0.08] py-20">
          <div className="max-w-[1200px] mx-auto px-6">
            <div className="mb-12">
              <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-white">
                专为长时间日常听歌打磨的原生细节
              </h2>
              <p className="mt-2 text-sm text-zinc-400 max-w-[64ch]">
                解决浏览器 PWA 缺少状态栏控制、播放中途报错断流、登录风控拦截与页面无法返回的四大核心痛点。
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <article className="lg:col-span-2 rounded-2xl bg-[#11131A] border border-white/[0.08] p-7 flex flex-col justify-between gap-4">
                <div>
                  <div className="text-xs font-mono text-zinc-500 mb-2">01. 官方接口与会员保障</div>
                  <h3 className="font-display text-xl font-semibold text-white">
                    完整保留 YouTube Premium 会员权益，零破解风险
                  </h3>
                  <p className="mt-3 text-sm text-zinc-400 leading-relaxed max-w-[60ch]">
                    直接加载官方 <span className="font-mono text-zinc-200">music.youtube.com</span>，无广告、256kbps 高音质与私人歌单实时同步。登录 Google 账号时自动切换兼容 UA 并剥离 Chromium 特征头，同时内置浏览器 Cookie 一键同步作为兜底，彻底告别「此浏览器或应用可能不安全」。
                  </p>
                </div>
                <div className="pt-4 border-t border-white/[0.07] flex flex-wrap gap-x-6 gap-y-1 text-xs text-zinc-400">
                  <span>持久化独立分区 Cookie</span>
                  <span>Firefox 登录态防风控</span>
                  <span>支持代理服务器配置</span>
                </div>
              </article>

              <article className="rounded-2xl bg-[#11131A] border border-white/[0.08] overflow-hidden flex flex-col">
                <div className="h-40 relative bg-[#0D0F14]">
                  {!craftImgFailed ? (
                    <img
                      src={CRAFT_IMAGE_PATH}
                      alt="精密音量旋钮与声学质感"
                      referrerPolicy="no-referrer"
                      onError={() => setCraftImgFailed(true)}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-[#191C26] to-[#0B0C10]" />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-[#11131A] via-transparent to-transparent" />
                </div>
                <div className="p-6 pt-3 flex-1 flex flex-col justify-between">
                  <div>
                    <div className="text-xs font-mono text-zinc-500 mb-1.5">02. 状态栏迷你控台</div>
                    <h3 className="font-display text-lg font-semibold text-white">
                      封面、进度与音量一触即达
                    </h3>
                    <p className="mt-2 text-sm text-zinc-400 leading-relaxed">
                      无需切回主窗口，点击 macOS 顶部菜单栏图标即可查看封面、拖动进度条、切歌或微调音量。
                    </p>
                  </div>
                </div>
              </article>

              <article className="rounded-2xl bg-[#11131A] border border-white/[0.08] p-7">
                <div className="text-xs font-mono text-zinc-500 mb-2">03. 播放防中断</div>
                <h3 className="font-display text-lg font-semibold text-white">
                  后台防休眠与断流自恢复
                </h3>
                <p className="mt-2.5 text-sm text-zinc-400 leading-relaxed">
                  播放时自动启用系统防挂起锁（PowerSaveBlocker），放行 DRM 媒体权限，不改写音频 CDN 请求头，并自动确认闲置弹窗、在流异常或缓冲卡死时自动恢复。
                </p>
              </article>

              <article className="lg:col-span-2 rounded-2xl bg-[#11131A] border border-white/[0.08] p-7 flex flex-col justify-between gap-4">
                <div>
                  <div className="text-xs font-mono text-zinc-500 mb-2">04. 原生导航与外链隔离</div>
                  <h3 className="font-display text-xl font-semibold text-white">
                    常驻返回 / 首页工具栏，永不被困在未知页面
                  </h3>
                  <p className="mt-3 text-sm text-zinc-400 leading-relaxed max-w-[60ch]">
                    macOS 窗口左上角与隐藏标题栏无缝融合原生返回、前进、刷新与首页按钮，支持触控板双指滑动与 <span className="font-mono text-zinc-200">⌘[ / ⌘]</span> 快捷键；帮助页及非音乐外链自动转交默认浏览器打开，Android 端亦在离开主页时自动展示悬浮返回条。
                  </p>
                </div>
                <div className="pt-4 border-t border-white/[0.07] flex flex-wrap gap-x-6 gap-y-1 text-xs text-zinc-400">
                  <span>触控板双指返回/前进</span>
                  <span>外链自动转交系统浏览器</span>
                  <span>一键直达 music.youtube.com</span>
                </div>
              </article>
            </div>
          </div>
        </section>

        {/* Section 4: Open-Source README & GitHub Pages Delivery Showcase */}
        <section id="open-source" className="border-t border-white/[0.08] py-20">
          <div className="max-w-[1200px] mx-auto px-6">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              <div className="lg:col-span-5 space-y-5">
                <div className="text-xs font-mono text-zinc-500">MIT 开源发布套件</div>
                <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-white">
                  已为你的仓库备齐 README、LICENSE 与 GitHub Pages 下载官网
                </h2>
                <p className="text-sm text-zinc-400 leading-relaxed">
                  在构建工坊点击推送到 GitHub 后，会自动向你的仓库写入全新设计的开源 <span className="font-mono text-zinc-200">README.md</span>（带动态版本与下载量徽章）、标准 <span className="font-mono text-zinc-200">LICENSE</span>，以及零依赖静态官网 <span className="font-mono text-zinc-200">docs/index.html</span>——开启 GitHub Pages（选择 <span className="font-mono text-zinc-200">main / docs</span>）即可拥有公开下载主页。
                </p>

                <div className="pt-2 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => onOpenStudio('github')}
                    className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-[#FF0033] hover:bg-[#E0002D] rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <span>推送开源仓库并自动发版</span>
                    <ArrowRight className="w-3.5 h-3.5 shrink-0" />
                  </button>
                  <button
                    type="button"
                    disabled={hasConfigErrors}
                    onClick={onExportFullZip}
                    className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-medium text-zinc-200 bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.1] disabled:opacity-40 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5 shrink-0" />
                    <span>下载完整开源源码 (.zip)</span>
                  </button>
                </div>

                {githubRepoUrl && (
                  <div className="pt-2 text-xs text-zinc-400">
                    当前绑定仓库：{' '}
                    <a
                      href={githubRepoUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-zinc-200 hover:text-white underline underline-offset-4"
                    >
                      {boundRepo}
                    </a>
                  </div>
                )}
              </div>

              <div className="lg:col-span-7 rounded-2xl bg-[#11131A] border border-white/[0.08] overflow-hidden">
                <div className="px-4 py-3 border-b border-white/[0.08] flex items-center justify-between gap-4 bg-[#0D0F15]">
                  <div className="flex items-center gap-2 text-xs font-mono text-zinc-300">
                    <span>README.md</span>
                    <span className="text-zinc-600" aria-hidden="true">·</span>
                    <span className="text-zinc-500">仓库首页预览</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => readmeFile && handleCopy('readme', readmeFile.content)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium text-zinc-300 bg-white/[0.06] hover:bg-white/[0.12] rounded-md transition-colors cursor-pointer"
                  >
                    {copiedId === 'readme' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedId === 'readme' ? '已复制 Markdown' : '复制 README'}</span>
                  </button>
                </div>
                <pre className="p-5 text-xs font-mono text-zinc-300 leading-relaxed max-h-[380px] overflow-auto bg-[#090A0E] whitespace-pre-wrap">
                  {readmeFile?.content || ''}
                </pre>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Quiet Footer */}
      <footer className="border-t border-white/[0.08] py-10">
        <div className="max-w-[1200px] mx-auto px-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs text-zinc-500">
          <div>
            <span className="font-display font-semibold text-zinc-200">{appDisplayName}</span>
            <span className="mx-2" aria-hidden="true">·</span>
            <span>MIT License</span>
            <span className="mx-2" aria-hidden="true">·</span>
            <span>社区独立开源项目，与 Google / YouTube 无官方关联</span>
          </div>
          <div className="flex items-center gap-5">
            {githubRepoUrl && (
              <a
                href={githubRepoUrl}
                target="_blank"
                rel="noreferrer"
                className="hover:text-white transition-colors"
              >
                GitHub 仓库
              </a>
            )}
            <button
              type="button"
              onClick={() => onOpenStudio('config')}
              className="hover:text-white transition-colors cursor-pointer"
            >
              自定义品牌与配置
            </button>
            <button
              type="button"
              onClick={() => onOpenStudio('github')}
              className="hover:text-white transition-colors cursor-pointer"
            >
              构建工坊
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
