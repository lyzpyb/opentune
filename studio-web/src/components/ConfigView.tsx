import { RotateCcw, ArrowRight } from 'lucide-react';
import type {
  ClientConfig,
  ConfigValidationErrors,
  MacArchitecture,
  WorkspaceTab,
} from '../types/client';

interface ConfigViewProps {
  config: ClientConfig;
  errors: ConfigValidationErrors;
  onUpdate: (patch: Partial<ClientConfig>) => void;
  onReset: () => void;
  onNavigateTab: (tab: WorkspaceTab) => void;
}

interface ToggleRowProps {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}

function ToggleRow({ id, label, description, checked, onChange }: ToggleRowProps) {
  return (
    <div className="flex items-start justify-between gap-4 py-3.5">
      <div className="min-w-0">
        <label htmlFor={id} className="block text-sm font-medium text-zinc-100 cursor-pointer">
          {label}
        </label>
        <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed">{description}</p>
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors cursor-pointer mt-0.5 ${
          checked ? 'bg-[#FF0033]' : 'bg-zinc-700'
        }`}
      >
        <span className="sr-only">{label}</span>
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            checked ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  );
}

export function ConfigView({
  config,
  errors,
  onUpdate,
  onReset,
  onNavigateTab,
}: ConfigViewProps) {
  const errorCount = Object.keys(errors).length;

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-6 border-b border-white/[0.08]">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            客户端参数与 YouTube Premium 权益配置
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            所有修改会实时同步到 macOS（Electron）与 Android（Kotlin WebView）的全部工程源码与打包脚本中。
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-zinc-300 hover:text-white bg-white/[0.05] hover:bg-white/[0.09] border border-white/[0.08] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>恢复默认配置</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigateTab('source')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-white/[0.1] hover:bg-white/[0.16] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <span>查看生成源码</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {errorCount > 0 && (
        <div
          role="alert"
          className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-200 flex items-center justify-between gap-4"
        >
          <span>当前存在 {errorCount} 项配置校验错误，修正后方可导出完整工程包。</span>
        </div>
      )}

      {/* Group 1: Identity & Web Entry */}
      <section className="bg-[#12141A] border border-white/[0.08] rounded-xl p-6 space-y-5">
        <div>
          <h2 className="text-base font-semibold text-white">基础应用标识与入口链接</h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            同时应用于 macOS .dmg 应用信息与 Android .apk 的 applicationId
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="space-y-1.5">
            <label htmlFor="cfg-app-name" className="block text-xs font-medium text-zinc-300">
              客户端显示名称
            </label>
            <input
              id="cfg-app-name"
              type="text"
              value={config.appName}
              onChange={(e) => onUpdate({ appName: e.target.value })}
              className="w-full px-3.5 py-2 text-sm text-white bg-[#0B0C0F] border border-white/[0.1] rounded-lg focus:border-[#FF0033] focus:outline-none"
              placeholder="YT Music Native"
            />
            {errors.appName ? (
              <p className="text-xs text-red-400">{errors.appName}</p>
            ) : (
              <p className="text-[11px] text-zinc-500">显示在 macOS 启动台、程序坞及 Android 桌面图标下方</p>
            )}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="cfg-bundle-id" className="block text-xs font-medium text-zinc-300">
              Bundle ID / Android 包名
            </label>
            <input
              id="cfg-bundle-id"
              type="text"
              value={config.bundleId}
              onChange={(e) => onUpdate({ bundleId: e.target.value })}
              className="w-full px-3.5 py-2 text-sm font-mono text-white bg-[#0B0C0F] border border-white/[0.1] rounded-lg focus:border-[#FF0033] focus:outline-none"
              placeholder="com.custom.ytmusic"
            />
            {errors.bundleId ? (
              <p className="text-xs text-red-400">{errors.bundleId}</p>
            ) : (
              <p className="text-[11px] text-zinc-500">用于隔离应用数据目录，支持与官方 App 共存安装</p>
            )}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="cfg-start-url" className="block text-xs font-medium text-zinc-300">
              网页接口入口 URL
            </label>
            <input
              id="cfg-start-url"
              type="url"
              value={config.startUrl}
              onChange={(e) => onUpdate({ startUrl: e.target.value })}
              className="w-full px-3.5 py-2 text-sm font-mono text-white bg-[#0B0C0F] border border-white/[0.1] rounded-lg focus:border-[#FF0033] focus:outline-none"
              placeholder="https://music.youtube.com"
            />
            {errors.startUrl ? (
              <p className="text-xs text-red-400">{errors.startUrl}</p>
            ) : (
              <p className="text-[11px] text-zinc-500">建议使用官方 https://music.youtube.com 以获得完整曲库与推荐</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="cfg-version" className="block text-xs font-medium text-zinc-300">
                发布版本号
              </label>
              <input
                id="cfg-version"
                type="text"
                value={config.version}
                onChange={(e) => onUpdate({ version: e.target.value })}
                className="w-full px-3.5 py-2 text-sm font-mono text-white bg-[#0B0C0F] border border-white/[0.1] rounded-lg focus:border-[#FF0033] focus:outline-none tabular-nums"
                placeholder="1.0.0"
              />
              {errors.version && <p className="text-xs text-red-400">{errors.version}</p>}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="cfg-mac-arch" className="block text-xs font-medium text-zinc-300">
                macOS 目标架构
              </label>
              <select
                id="cfg-mac-arch"
                value={config.macArch}
                onChange={(e) => onUpdate({ macArch: e.target.value as MacArchitecture })}
                className="w-full px-3 py-2 text-sm text-white bg-[#0B0C0F] border border-white/[0.1] rounded-lg focus:border-[#FF0033] focus:outline-none"
              >
                <option value="universal">Universal (M系 + Intel)</option>
                <option value="arm64">Apple Silicon (M1–M4)</option>
                <option value="x64">Intel (x86_64)</option>
              </select>
            </div>
          </div>

          <div className="md:col-span-2 space-y-1.5">
            <label htmlFor="cfg-proxy" className="block text-xs font-medium text-zinc-300">
              macOS 独立代理地址（可选，留空默认跟随系统网络）
            </label>
            <input
              id="cfg-proxy"
              type="text"
              value={config.proxyServer}
              onChange={(e) => onUpdate({ proxyServer: e.target.value })}
              className="w-full px-3.5 py-2 text-sm font-mono text-white bg-[#0B0C0F] border border-white/[0.1] rounded-lg focus:border-[#FF0033] focus:outline-none"
              placeholder="例如 http://127.0.0.1:7890 或 socks5://127.0.0.1:1080"
            />
            {errors.proxyServer ? (
              <p className="text-xs text-red-400">{errors.proxyServer}</p>
            ) : (
              <p className="text-[11px] text-zinc-500">
                仅针对 Electron 独立分区生效，方便在分流网络环境下稳定访问 YouTube Music
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Group 2: YouTube Premium Preservation & Native Capabilities */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-[#12141A] border border-white/[0.08] rounded-xl p-6">
          <div className="pb-3 border-b border-white/[0.07]">
            <h2 className="text-base font-semibold text-white">YouTube Premium 登录与权益保障</h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              解决嵌入式浏览器登录 Google 账号报错与会员 Cookie 丢失的核心策略
            </p>
          </div>

          <div className="divide-y divide-white/[0.06] mt-1">
            <ToggleRow
              id="toggle-ua"
              label="Google 登录 User-Agent 净化"
              description="自动移除 Electron/ 与 Android WebView 的 ; wv 标识，防止 Google OAuth 报 403 disallowed_useragent。"
              checked={config.sanitizeUserAgent}
              onChange={(checked) => onUpdate({ sanitizeUserAgent: checked })}
            />
            <ToggleRow
              id="toggle-persist"
              label="持久化会员登录态与 Cookie"
              description="macOS 使用 persist:ytmusic 专属分区，Android 启用 CookieManager 第三方 Cookie 自动落盘，重启无需重登。"
              checked={config.persistLoginSession}
              onChange={(checked) => onUpdate({ persistLoginSession: checked })}
            />
            <ToggleRow
              id="toggle-upsell"
              label="隐藏冗余升级与引导打开 App 横幅"
              description="注入轻量 CSS 屏蔽网页端“在官方应用中打开”等提示条，提供更接近原生的沉浸式听歌界面。"
              checked={config.hideUpgradeBanner}
              onChange={(checked) => onUpdate({ hideUpgradeBanner: checked })}
            />
          </div>
        </section>

        <section className="bg-[#12141A] border border-white/[0.08] rounded-xl p-6">
          <div className="pb-3 border-b border-white/[0.07]">
            <h2 className="text-base font-semibold text-white">macOS 与 Android 原生系统集成</h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              按需开关桌面端与移动端的系统级后台播放与硬件媒体控制
            </p>
          </div>

          <div className="divide-y divide-white/[0.06] mt-1">
            <ToggleRow
              id="toggle-mac-keys"
              label="macOS 全局键盘媒体键 (F7/F8/F9)"
              description="通过 globalShortcut 绑定播放/暂停、上一首、下一首，无需切回窗口即可切歌。"
              checked={config.macMediaKeys}
              onChange={(checked) => onUpdate({ macMediaKeys: checked })}
            />
            <ToggleRow
              id="toggle-mac-tray"
              label="macOS 关闭窗口驻留菜单栏后台播放"
              description="点击红色关闭按钮仅隐藏窗口，在顶部状态栏托盘继续播放并提供快捷切歌菜单。"
              checked={config.macCloseToTray}
              onChange={(checked) => onUpdate({ macCloseToTray: checked })}
            />
            <ToggleRow
              id="toggle-mac-titlebar"
              label="macOS 隐藏式融合标题栏 (hiddenInset)"
              description="让红黄绿交通灯按钮融入 YouTube Music 顶栏，减少额外标题栏高度占用。"
              checked={config.macHiddenTitlebar}
              onChange={(checked) => onUpdate({ macHiddenTitlebar: checked })}
            />
            <ToggleRow
              id="toggle-android-fg"
              label="Android 息屏后台播放前台服务"
              description="启用 FOREGROUND_SERVICE_MEDIA_PLAYBACK + MediaStyle 锁屏通知与 WakeLock，熄屏切后台不断流。"
              checked={config.androidBackgroundService}
              onChange={(checked) =>
                onUpdate({
                  androidBackgroundService: checked,
                  androidMediaNotification: checked ? config.androidMediaNotification : false,
                  androidWakeLock: checked ? config.androidWakeLock : false,
                })
              }
            />
            <ToggleRow
              id="toggle-android-deeplink"
              label="Android 接管 music.youtube.com 链接"
              description="在系统里点击 YouTube Music 分享链接时，可直接选择用本客户端打开播放。"
              checked={config.androidDeepLinks}
              onChange={(checked) => onUpdate({ androidDeepLinks: checked })}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
