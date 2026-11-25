import { useEffect, useState } from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  ExternalLink,
  Volume2,
  Link2,
  Monitor,
  Smartphone,
  Download,
  ArrowRight,
} from 'lucide-react';
import type { ClientConfig, ParsedYtmLink, WorkspaceTab } from '../types/client';
import { SAMPLE_TRACKS } from '../data/sampleTracks';
import { formatSeconds, parseYtmUrl } from '../utils/ytmUrlParser';

interface LivePreviewViewProps {
  config: ClientConfig;
  onNavigateTab: (tab: WorkspaceTab) => void;
  onExportTarget: (scope: 'macos' | 'android') => void;
  hasConfigErrors: boolean;
}

export function LivePreviewView({
  config,
  onNavigateTab,
  onExportTarget,
  hasConfigErrors,
}: LivePreviewViewProps) {
  const [deviceMode, setDeviceMode] = useState<'macos' | 'android'>('macos');
  const [activeTrackIndex, setActiveTrackIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(64);
  const [urlInput, setUrlInput] = useState(SAMPLE_TRACKS[0].ytmUrl);
  const [parsedLink, setParsedLink] = useState<ParsedYtmLink>(() =>
    parseYtmUrl(SAMPLE_TRACKS[0].ytmUrl)
  );
  const [urlError, setUrlError] = useState<string | null>(null);
  const [showRealEmbed, setShowRealEmbed] = useState(false);
  const [imgErrors, setImgErrors] = useState<Record<string, boolean>>({});

  const activeTrack = SAMPLE_TRACKS[activeTrackIndex];

  useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setInterval(() => {
      setElapsedSec((prev) => (prev + 1 >= activeTrack.durationSec ? 0 : prev + 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isPlaying, activeTrack.durationSec]);

  const handleLoadUrl = (event: React.FormEvent) => {
    event.preventDefault();
    const result = parseYtmUrl(urlInput);
    if (!result.valid) {
      setUrlError(result.error ?? '链接无法解析');
      return;
    }
    setUrlError(null);
    setParsedLink(result);
    const matchingIdx = SAMPLE_TRACKS.findIndex((t) => t.videoId === result.videoId);
    if (matchingIdx >= 0) {
      setActiveTrackIndex(matchingIdx);
      setElapsedSec(0);
    }
    if (result.embedUrl) {
      setShowRealEmbed(true);
    }
  };

  const handleSelectTrack = (index: number) => {
    setActiveTrackIndex(index);
    setElapsedSec(0);
    setIsPlaying(true);
    const track = SAMPLE_TRACKS[index];
    setUrlInput(track.ytmUrl);
    setParsedLink(parseYtmUrl(track.ytmUrl));
    setUrlError(null);
  };

  const handlePrevTrack = () => {
    const nextIdx = (activeTrackIndex - 1 + SAMPLE_TRACKS.length) % SAMPLE_TRACKS.length;
    handleSelectTrack(nextIdx);
  };

  const handleNextTrack = () => {
    const nextIdx = (activeTrackIndex + 1) % SAMPLE_TRACKS.length;
    handleSelectTrack(nextIdx);
  };

  const progressPct = Math.min(100, Math.round((elapsedSec / activeTrack.durationSec) * 100));

  return (
    <div className="space-y-8">
      {/* Section 1: Header Summary & Direct Platform Exports */}
      <section className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 pb-6 border-b border-white/[0.08]">
        <div className="space-y-2 max-w-2xl">
          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
            <span>官方网页接口封装</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono text-zinc-300">{config.startUrl}</span>
            <span aria-hidden="true">·</span>
            <span>原生支持 YouTube Premium 会员权益</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-white">
            {config.appName} — macOS 与 Android 独立客户端
          </h1>
          <p className="text-sm text-zinc-400 leading-relaxed">
            告别浏览器 PWA 的息屏中断与快捷键受限。通过 Electron（.dmg）与 Android Kotlin WebView 前台媒体服务（.apk）直接承载
            YouTube Music 官方网页会话，自动净化 User-Agent 通过 Google 登录校验，持久化保存会员 Cookie 并完整接入系统级媒体控制。
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <button
            type="button"
            disabled={hasConfigErrors}
            onClick={() => onExportTarget('macos')}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-zinc-100 bg-white/[0.06] hover:bg-white/[0.11] disabled:opacity-40 border border-white/[0.09] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:cursor-not-allowed"
          >
            <Download className="w-3.5 h-3.5" />
            <span>下载 macOS 源码 (.dmg)</span>
          </button>
          <button
            type="button"
            disabled={hasConfigErrors}
            onClick={() => onExportTarget('android')}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-zinc-100 bg-white/[0.06] hover:bg-white/[0.11] disabled:opacity-40 border border-white/[0.09] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:cursor-not-allowed"
          >
            <Download className="w-3.5 h-3.5" />
            <span>下载 Android 源码 (.apk)</span>
          </button>
        </div>
      </section>

      {/* Section 2: Interactive Web Link Parser & Client Shell Preview */}
      <section className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-stretch">
        {/* Left 8 cols: Interactive macOS / Android Client Shell Preview */}
        <div className="xl:col-span-8 bg-[#12141A] border border-white/[0.08] rounded-xl p-5 flex flex-col justify-between gap-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-white">双端原生外壳交互预览</h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                实时反映你在「参数与权益配置」中启用的标题栏、托盘、息屏锁屏通知与网页播放器状态
              </p>
            </div>

            <div
              role="tablist"
              aria-label="客户端预览平台切换"
              className="inline-flex items-center gap-1 p-1 bg-white/[0.04] border border-white/[0.06] rounded-lg"
            >
              <button
                type="button"
                role="tab"
                aria-selected={deviceMode === 'macos'}
                onClick={() => setDeviceMode('macos')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  deviceMode === 'macos'
                    ? 'bg-white/[0.12] text-white'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Monitor className="w-3.5 h-3.5" />
                <span>macOS (.dmg)</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={deviceMode === 'android'}
                onClick={() => setDeviceMode('android')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  deviceMode === 'android'
                    ? 'bg-white/[0.12] text-white'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Smartphone className="w-3.5 h-3.5" />
                <span>Android (.apk)</span>
              </button>
            </div>
          </div>

          {deviceMode === 'macos' ? (
            /* macOS Desktop Client Preview Frame */
            <div className="flex-1 flex flex-col bg-[#07080A] border border-white/[0.08] rounded-lg overflow-hidden">
              {/* macOS Window Chrome */}
              <div className="h-10 px-3.5 bg-[#0E1015] border-b border-white/[0.07] flex items-center justify-between gap-4">
                <div className="flex items-center gap-2 shrink-0">
                  <span className="w-2.5 h-2.5 rounded-full bg-zinc-600" aria-hidden="true" />
                  <span className="w-2.5 h-2.5 rounded-full bg-zinc-600" aria-hidden="true" />
                  <span className="w-2.5 h-2.5 rounded-full bg-zinc-600" aria-hidden="true" />
                  <span className="ml-2 text-xs font-medium text-zinc-300 truncate max-w-[140px]">
                    {config.appName}
                  </span>
                </div>

                <div className="hidden sm:block min-w-0 flex-1 px-2 text-center">
                  <span className="block text-[11px] font-mono text-zinc-500 truncate">
                    {parsedLink.normalizedUrl ?? config.startUrl}
                  </span>
                </div>

                <div className="flex items-center gap-2 text-[11px] text-zinc-400 shrink-0 whitespace-nowrap">
                  <span>{config.macHiddenTitlebar ? '融合标题栏' : '标准标题栏'}</span>
                  <span aria-hidden="true">·</span>
                  <span>{config.macCloseToTray ? '菜单栏驻留' : '关闭退出'}</span>
                </div>
              </div>

              {/* Embedded Official YouTube Player OR Interactive Shell View */}
              <div className="flex-1 p-5 flex flex-col justify-between gap-5">
                {showRealEmbed && parsedLink.embedUrl ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs text-zinc-400 font-mono truncate">
                        官方网页接口直连 · {parsedLink.kind === 'playlist' ? `Playlist ${parsedLink.playlistId}` : `Video ${parsedLink.videoId}`}
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowRealEmbed(false)}
                        className="text-xs text-zinc-300 hover:text-white underline underline-offset-4 whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        切回客户端界面模拟
                      </button>
                    </div>
                    <div className="aspect-video w-full rounded-lg overflow-hidden bg-black border border-white/[0.08]">
                      <iframe
                        title="YouTube Music 官方网页播放器试听"
                        src={parsedLink.embedUrl}
                        className="w-full h-full"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                      />
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-center">
                    <div className="md:col-span-5">
                      <div className="aspect-square w-full max-w-[220px] mx-auto rounded-lg overflow-hidden bg-[#181B23] border border-white/[0.08]">
                        {!imgErrors[activeTrack.id] ? (
                          <img
                            src={activeTrack.coverSrc}
                            alt={`${activeTrack.title} 专辑封面`}
                            referrerPolicy="no-referrer"
                            onError={() =>
                              setImgErrors((prev) => ({ ...prev, [activeTrack.id]: true }))
                            }
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-xs text-zinc-500 p-4 text-center">
                            {activeTrack.album}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="md:col-span-7 space-y-4">
                      <div>
                        <div className="text-xs text-zinc-400 flex items-center gap-2">
                          <span>{activeTrack.bitrateLabel}</span>
                          <span aria-hidden="true">·</span>
                          <span>{config.persistLoginSession ? 'persist:ytmusic 会话' : '临时会话'}</span>
                        </div>
                        <h3 className="text-lg font-semibold text-white mt-1 leading-snug">
                          {activeTrack.title}
                        </h3>
                        <p className="text-sm text-zinc-400 mt-0.5">{activeTrack.artist}</p>
                      </div>

                      <div className="space-y-1.5">
                        <div className="h-1.5 w-full bg-white/[0.08] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-[#FF0033] transition-all duration-200"
                            style={{ width: `${progressPct}%` }}
                          />
                        </div>
                        <div className="flex items-center justify-between text-[11px] font-mono text-zinc-500 tabular-nums">
                          <span>{formatSeconds(elapsedSec)}</span>
                          <span>{activeTrack.duration}</span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-4 pt-1">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={handlePrevTrack}
                            aria-label="上一首曲目"
                            className="p-2.5 text-zinc-300 hover:text-white bg-white/[0.05] hover:bg-white/[0.1] rounded-lg transition-colors cursor-pointer"
                          >
                            <SkipBack className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setIsPlaying((p) => !p)}
                            aria-label={isPlaying ? '暂停播放' : '开始播放'}
                            className="p-2.5 text-white bg-[#FF0033] hover:bg-[#E0002D] rounded-lg transition-colors cursor-pointer"
                          >
                            {isPlaying ? (
                              <Pause className="w-4 h-4" />
                            ) : (
                              <Play className="w-4 h-4" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={handleNextTrack}
                            aria-label="下一首曲目"
                            className="p-2.5 text-zinc-300 hover:text-white bg-white/[0.05] hover:bg-white/[0.1] rounded-lg transition-colors cursor-pointer"
                          >
                            <SkipForward className="w-4 h-4" />
                          </button>
                        </div>

                        {parsedLink.embedUrl && (
                          <button
                            type="button"
                            onClick={() => setShowRealEmbed(true)}
                            className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-300 hover:text-white transition-colors whitespace-nowrap cursor-pointer"
                          >
                            <Volume2 className="w-3.5 h-3.5 text-[#FF0033]" />
                            <span>加载真实音频流</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Native macOS Capabilities Footer Row */}
                <div className="pt-4 border-t border-white/[0.07] flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-400">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span>
                      系统媒体键：{config.macMediaKeys ? '已接管 (F7/F8/F9)' : '未启用'}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      UA 净化：{config.sanitizeUserAgent ? '已移除 Electron 标识' : '原始 UA'}
                    </span>
                  </div>
                  <span className="font-mono text-[11px] text-zinc-500">
                    arch: {config.macArch}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            /* Android Mobile Client & Lockscreen MediaStyle Preview */
            <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-5 items-stretch">
              {/* Android WebView Screen */}
              <div className="bg-[#07080A] border border-white/[0.08] rounded-xl p-4 flex flex-col justify-between gap-4">
                <div className="flex items-center justify-between text-[11px] font-mono text-zinc-500">
                  <span>Android WebView · 沉浸深黑</span>
                  <span>minSdk 26 / targetSdk 35</span>
                </div>

                <div className="flex items-center gap-3.5">
                  <div className="w-16 h-16 rounded-lg overflow-hidden bg-[#181B23] shrink-0 border border-white/[0.08]">
                    {!imgErrors[activeTrack.id] ? (
                      <img
                        src={activeTrack.coverSrc}
                        alt={`${activeTrack.title} 封面`}
                        referrerPolicy="no-referrer"
                        onError={() =>
                          setImgErrors((prev) => ({ ...prev, [activeTrack.id]: true }))
                        }
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[10px] text-zinc-500">
                        YTM
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-white truncate">
                      {activeTrack.title}
                    </div>
                    <div className="text-xs text-zinc-400 truncate mt-0.5">
                      {activeTrack.artist}
                    </div>
                    <div className="text-[11px] text-zinc-500 mt-1">
                      {config.sanitizeUserAgent ? '已移除 "; wv" · Google 登录放行' : '默认 WebView UA'}
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="h-1 w-full bg-white/[0.08] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#FF0033]"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] font-mono text-zinc-500 tabular-nums">
                    <span>{formatSeconds(elapsedSec)}</span>
                    <span>{activeTrack.duration}</span>
                  </div>
                </div>

                <div className="text-[11px] text-zinc-400 pt-2 border-t border-white/[0.07] flex items-center justify-between">
                  <span>包名：{config.bundleId}</span>
                  <span>{config.androidDeepLinks ? '接管 music.youtube.com 深链' : '未启用深链'}</span>
                </div>
              </div>

              {/* Android Lockscreen MediaStyle Foreground Service Preview */}
              <div className="bg-[#0B0D12] border border-white/[0.08] rounded-xl p-4 flex flex-col justify-between gap-4">
                <div className="flex items-center justify-between text-[11px] text-zinc-400">
                  <span>息屏锁屏通知预览（MediaStyle）</span>
                  <span className="font-mono text-zinc-500">
                    {config.androidBackgroundService ? 'ForegroundService 运行中' : '前台服务已关闭'}
                  </span>
                </div>

                <div className="bg-[#151821] border border-white/[0.09] rounded-lg p-3.5 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[11px] text-zinc-400">
                        {config.appName} · {isPlaying ? '后台播放中' : '已暂停'}
                      </div>
                      <div className="text-sm font-medium text-white truncate mt-0.5">
                        {activeTrack.title}
                      </div>
                      <div className="text-xs text-zinc-400 truncate">
                        {activeTrack.artist}
                      </div>
                    </div>
                    <img
                      src={activeTrack.coverSrc}
                      alt="锁屏通知缩略图"
                      referrerPolicy="no-referrer"
                      className="w-11 h-11 rounded object-cover shrink-0 border border-white/[0.08]"
                    />
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-white/[0.06]">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handlePrevTrack}
                        aria-label="Android 锁屏上一首"
                        className="p-2 text-zinc-300 hover:text-white bg-white/[0.05] hover:bg-white/[0.1] rounded-md transition-colors cursor-pointer"
                      >
                        <SkipBack className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsPlaying((p) => !p)}
                        aria-label={isPlaying ? 'Android 锁屏暂停' : 'Android 锁屏播放'}
                        className="p-2 text-white bg-[#FF0033] hover:bg-[#E0002D] rounded-md transition-colors cursor-pointer"
                      >
                        {isPlaying ? (
                          <Pause className="w-3.5 h-3.5" />
                        ) : (
                          <Play className="w-3.5 h-3.5" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={handleNextTrack}
                        aria-label="Android 锁屏下一首"
                        className="p-2 text-zinc-300 hover:text-white bg-white/[0.05] hover:bg-white/[0.1] rounded-md transition-colors cursor-pointer"
                      >
                        <SkipForward className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <span className="text-[11px] text-zinc-500">
                      {config.androidWakeLock ? 'WakeLock 保活' : '常规电源策略'}
                    </span>
                  </div>
                </div>

                <p className="text-xs text-zinc-400 leading-relaxed">
                  通过 <span className="font-mono text-zinc-300">MainActivity.onPause()</span> 不暂停 WebView 音频内核，并配合{' '}
                  <span className="font-mono text-zinc-300">MediaPlaybackService</span> 维持系统前台优先级，彻底解决浏览器切后台即断流的问题。
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Right 4 cols: Web URL Tester & Quick Sample Queue */}
        <div className="xl:col-span-4 bg-[#12141A] border border-white/[0.08] rounded-xl p-5 flex flex-col justify-between gap-5">
          <div className="space-y-4">
            <div>
              <h2 className="text-base font-semibold text-white">网页接口链接测试</h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                粘贴任意 <span className="font-mono text-zinc-300">music.youtube.com</span> 单曲或歌单链接验证解析与直连播放
              </p>
            </div>

            <form onSubmit={handleLoadUrl} className="space-y-2.5" noValidate>
              <label htmlFor="ytm-url-input" className="block text-xs font-medium text-zinc-300">
                YouTube Music 曲目或歌单链接
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1 min-w-0">
                  <Link2 className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="ytm-url-input"
                    type="url"
                    value={urlInput}
                    onChange={(e) => {
                      setUrlInput(e.target.value);
                      if (urlError) setUrlError(null);
                    }}
                    placeholder="https://music.youtube.com/watch?v=..."
                    className="w-full pl-8 pr-3 py-2 text-xs font-mono text-zinc-100 bg-[#0B0C0F] border border-white/[0.1] rounded-lg focus:border-[#FF0033] focus:outline-none"
                  />
                </div>
                <button
                  type="submit"
                  className="px-3.5 py-2 text-xs font-medium text-white bg-white/[0.1] hover:bg-white/[0.16] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  载入链接
                </button>
              </div>

              {urlError ? (
                <p role="alert" className="text-xs text-red-400">
                  {urlError}
                </p>
              ) : (
                <div className="text-[11px] font-mono text-zinc-400 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-emerald-400">解析正常</span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {parsedLink.videoId
                      ? `ID: ${parsedLink.videoId}`
                      : parsedLink.playlistId
                        ? `List: ${parsedLink.playlistId}`
                        : '首页入口'}
                  </span>
                  {parsedLink.normalizedUrl && (
                    <a
                      href={parsedLink.normalizedUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-zinc-300 hover:text-white underline underline-offset-2 ml-auto"
                    >
                      <span>官方页打开</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              )}
            </form>

            {/* Sample Queue */}
            <div className="pt-3 border-t border-white/[0.07] space-y-2">
              <div className="text-xs font-medium text-zinc-400">快速试听队列</div>
              <div className="space-y-1.5">
                {SAMPLE_TRACKS.map((track, idx) => {
                  const selected = idx === activeTrackIndex;
                  return (
                    <button
                      key={track.id}
                      type="button"
                      onClick={() => handleSelectTrack(idx)}
                      className={`w-full flex items-center gap-3 p-2 rounded-lg text-left transition-colors cursor-pointer ${
                        selected
                          ? 'bg-white/[0.08] text-white'
                          : 'hover:bg-white/[0.04] text-zinc-300'
                      }`}
                    >
                      <img
                        src={track.coverSrc}
                        alt={track.title}
                        referrerPolicy="no-referrer"
                        className="w-9 h-9 rounded object-cover shrink-0 border border-white/[0.08]"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-medium truncate">
                          {track.title}
                        </span>
                        <span className="block text-[11px] text-zinc-500 truncate">
                          {track.artist}
                        </span>
                      </span>
                      <span className="text-[11px] font-mono text-zinc-500 tabular-nums shrink-0">
                        {track.duration}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-white/[0.07] flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => onNavigateTab('config')}
              className="text-xs font-medium text-zinc-300 hover:text-white inline-flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <span>定制包名与会员权益参数</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onNavigateTab('source')}
              className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
            >
              查看源码
            </button>
          </div>
        </div>
      </section>

      {/* Section 3: Comparison Table — Browser PWA vs Native Wrapped Clients */}
      <section className="bg-[#12141A] border border-white/[0.08] rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-white/[0.08] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-white">
              为什么需要原生封装客户端（对比浏览器地址栏安装 PWA）
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              同样走官方 music.youtube.com 网页接口，但补齐操作系统级的后台保活、媒体键与账号会话隔离
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigateTab('guide')}
            className="text-xs font-medium text-[#FF0033] hover:text-[#FF335C] inline-flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <span>查看一键出包指南</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-white/[0.08] text-zinc-400 bg-white/[0.02]">
                <th className="py-3 px-5 font-medium">核心体验维度</th>
                <th className="py-3 px-5 font-medium">浏览器地址栏 PWA</th>
                <th className="py-3 px-5 font-medium text-white">macOS 原生客户端 (.dmg)</th>
                <th className="py-3 px-5 font-medium text-white">Android 原生客户端 (.apk)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06] text-zinc-300">
              <tr className="hover:bg-white/[0.02]">
                <td className="py-3 px-5 font-medium text-zinc-200">YouTube Premium 权益</td>
                <td className="py-3 px-5 text-zinc-400">依赖浏览器登录态，易受清理影响</td>
                <td className="py-3 px-5">独立 persist:ytmusic 分区，无广告 256kbps</td>
                <td className="py-3 px-5">CookieManager 持久化 + 去 &ldquo;; wv&rdquo; 防拦截</td>
              </tr>
              <tr className="hover:bg-white/[0.02]">
                <td className="py-3 px-5 font-medium text-zinc-200">后台与息屏播放</td>
                <td className="py-3 px-5 text-zinc-400">Android 切后台或锁屏易被系统休眠暂停</td>
                <td className="py-3 px-5">关闭窗口最小化至菜单栏托盘持续播放</td>
                <td className="py-3 px-5">MediaPlaybackService 前台服务 + WakeLock 保活</td>
              </tr>
              <tr className="hover:bg-white/[0.02]">
                <td className="py-3 px-5 font-medium text-zinc-200">硬件与锁屏媒体控制</td>
                <td className="py-3 px-5 text-zinc-400">常与其他浏览器标签页抢占焦点</td>
                <td className="py-3 px-5">globalShortcut 全局接管键盘 F7/F8/F9 媒体键</td>
                <td className="py-3 px-5">MediaSessionCompat 锁屏卡片与蓝牙耳机切歌</td>
              </tr>
              <tr className="hover:bg-white/[0.02]">
                <td className="py-3 px-5 font-medium text-zinc-200">接口与账号安全性</td>
                <td className="py-3 px-5 text-zinc-400">官方网页接口</td>
                <td className="py-3 px-5">直连官方 music.youtube.com，零第三方中转</td>
                <td className="py-3 px-5">直连官方 music.youtube.com，支持深链直达</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
