import { useState } from 'react';
import { Copy, Check, Download } from 'lucide-react';
import type { ClientConfig } from '../types/client';

interface BuildGuideViewProps {
  config: ClientConfig;
  onExportFullZip: () => void;
  hasConfigErrors: boolean;
}

type GuideTab = 'cloud' | 'macos' | 'android';

export function BuildGuideView({
  config,
  onExportFullZip,
  hasConfigErrors,
}: BuildGuideViewProps) {
  const [guideTab, setGuideTab] = useState<GuideTab>('cloud');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyText = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId(null), 1800);
    } catch {
      // Ignore clipboard failure
    }
  };

  const cloudCommands = `git init
git add .
git commit -m "init ${config.appName} macOS DMG & Android APK client"
git branch -M main
git remote add origin https://github.com/<你的用户名>/ytm-native-client.git
git push -u origin main`;

  const macCommands = `cd macos-electron
chmod +x build-mac.sh
./build-mac.sh

# 产出安装包路径：
# macos-electron/dist/*.dmg`;

  const androidCommands = `cd android-webview
# 方式 A：使用系统已安装的 Gradle 8.10+ 直接编译 Release APK
gradle assembleRelease

# 方式 B：用 Android Studio 打开 android-webview 目录
# 点击顶部菜单 Build -> Build Bundle(s) / APK(s) -> Build APK(s)

# 产出安装包路径：
# android-webview/app/build/outputs/apk/release/app-release.apk`;

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-6 border-b border-white/[0.08]">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            从源码到可安装 .dmg 与 .apk 出包指南
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            导出完整工程压缩包后，支持 GitHub Actions 免环境云端并行编译，也支持在 macOS / Android Studio 本机构建。
          </p>
        </div>

        <button
          type="button"
          disabled={hasConfigErrors}
          onClick={onExportFullZip}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-zinc-100 bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.09] disabled:opacity-40 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:cursor-not-allowed"
        >
          <Download className="w-3.5 h-3.5" />
          <span>下载完整工程 (.zip)</span>
        </button>
      </div>

      {/* Build Path Tabs */}
      <div className="space-y-5">
        <div
          role="tablist"
          aria-label="选择构建方式"
          className="inline-flex flex-wrap items-center gap-1 p-1 bg-white/[0.04] border border-white/[0.06] rounded-lg"
        >
          <button
            type="button"
            role="tab"
            aria-selected={guideTab === 'cloud'}
            onClick={() => setGuideTab('cloud')}
            className={`px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              guideTab === 'cloud'
                ? 'bg-white/[0.12] text-white'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            01. GitHub Actions 云端一键出包（推荐）
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={guideTab === 'macos'}
            onClick={() => setGuideTab('macos')}
            className={`px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              guideTab === 'macos'
                ? 'bg-white/[0.12] text-white'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            02. macOS 本机打包 (.dmg)
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={guideTab === 'android'}
            onClick={() => setGuideTab('android')}
            className={`px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              guideTab === 'android'
                ? 'bg-white/[0.12] text-white'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            03. Android 本机打包 (.apk)
          </button>
        </div>

        {guideTab === 'cloud' && (
          <section className="bg-[#12141A] border border-white/[0.08] rounded-xl p-6 space-y-5">
            <div className="space-y-1.5">
              <h2 className="text-base font-semibold text-white">
                零本地环境依赖：GitHub Actions 同时产出 macOS .dmg 与 Android .apk
              </h2>
              <p className="text-xs text-zinc-400 leading-relaxed">
                导出的 ZIP 内已内置 <span className="font-mono text-zinc-300">.github/workflows/build-clients.yml</span>。
                推送到你的私有 GitHub 仓库后，GitHub 会自动分配 <span className="font-mono text-zinc-300">macos-latest</span> 与{' '}
                <span className="font-mono text-zinc-300">ubuntu-latest</span> 构建机并行编译，约 3–5 分钟即可在 Actions Artifacts 中直接下载双端安装包。
              </p>
            </div>

            <ol className="space-y-3 text-sm text-zinc-300 list-decimal list-inside">
              <li>点击右上角「导出完整工程 (.zip)」并解压到本地目录。</li>
              <li>在 GitHub 创建一个新的私有仓库（Private Repository）。</li>
              <li>在解压后的工程根目录运行以下命令推送代码，触发自动构建：</li>
            </ol>

            <div className="bg-[#090A0E] border border-white/[0.08] rounded-lg overflow-hidden">
              <div className="px-4 py-2 border-b border-white/[0.07] flex items-center justify-between text-xs text-zinc-400">
                <span className="font-mono">Terminal · 推送至 GitHub 触发双端编译</span>
                <button
                  type="button"
                  onClick={() => copyText('cloud', cloudCommands)}
                  className="inline-flex items-center gap-1.5 text-zinc-300 hover:text-white cursor-pointer"
                >
                  {copiedId === 'cloud' ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span>已复制</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>复制命令</span>
                    </>
                  )}
                </button>
              </div>
              <pre className="p-4 text-xs font-mono text-zinc-200 overflow-x-auto leading-relaxed">
                <code>{cloudCommands}</code>
              </pre>
            </div>
          </section>
        )}

        {guideTab === 'macos' && (
          <section className="bg-[#12141A] border border-white/[0.08] rounded-xl p-6 space-y-5">
            <div className="space-y-1.5">
              <h2 className="text-base font-semibold text-white">
                macOS 本机构建通用安装镜像（.dmg）
              </h2>
              <p className="text-xs text-zinc-400 leading-relaxed">
                前置要求：macOS 系统 + Node.js 20+。当前已配置目标架构为{' '}
                <span className="font-mono text-zinc-200">{config.macArch}</span>，产物输出至{' '}
                <span className="font-mono text-zinc-200">macos-electron/dist/</span>。
              </p>
            </div>

            <div className="bg-[#090A0E] border border-white/[0.08] rounded-lg overflow-hidden">
              <div className="px-4 py-2 border-b border-white/[0.07] flex items-center justify-between text-xs text-zinc-400">
                <span className="font-mono">macOS Terminal</span>
                <button
                  type="button"
                  onClick={() => copyText('macos', macCommands)}
                  className="inline-flex items-center gap-1.5 text-zinc-300 hover:text-white cursor-pointer"
                >
                  {copiedId === 'macos' ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span>已复制</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>复制命令</span>
                    </>
                  )}
                </button>
              </div>
              <pre className="p-4 text-xs font-mono text-zinc-200 overflow-x-auto leading-relaxed">
                <code>{macCommands}</code>
              </pre>
            </div>

            <p className="text-xs text-zinc-400 leading-relaxed">
              首次打开未经过 Apple 公证的自编译 <span className="font-mono text-zinc-300">.dmg</span> 应用时，如 macOS 提示“无法验证开发者”，只需在「系统设置 → 隐私与安全性」点击「仍要打开」，或在终端执行{' '}
              <span className="font-mono text-zinc-300">xattr -cr &quot;/Applications/{config.appName}.app&quot;</span> 即可正常启动。
            </p>
          </section>
        )}

        {guideTab === 'android' && (
          <section className="bg-[#12141A] border border-white/[0.08] rounded-xl p-6 space-y-5">
            <div className="space-y-1.5">
              <h2 className="text-base font-semibold text-white">
                Android 本机编译可侧载安装包（.apk）
              </h2>
              <p className="text-xs text-zinc-400 leading-relaxed">
                前置要求：JDK 17 + Android SDK（API 35）或直接安装 Android Studio。工程默认已配置侧载签名，编译完成后直接传输至手机安装。
              </p>
            </div>

            <div className="bg-[#090A0E] border border-white/[0.08] rounded-lg overflow-hidden">
              <div className="px-4 py-2 border-b border-white/[0.07] flex items-center justify-between text-xs text-zinc-400">
                <span className="font-mono">Android Build CLI</span>
                <button
                  type="button"
                  onClick={() => copyText('android', androidCommands)}
                  className="inline-flex items-center gap-1.5 text-zinc-300 hover:text-white cursor-pointer"
                >
                  {copiedId === 'android' ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span>已复制</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>复制命令</span>
                    </>
                  )}
                </button>
              </div>
              <pre className="p-4 text-xs font-mono text-zinc-200 overflow-x-auto leading-relaxed">
                <code>{androidCommands}</code>
              </pre>
            </div>

            <p className="text-xs text-zinc-400 leading-relaxed">
              安装后首次打开请允许「通知权限」（用于显示锁屏 MediaStyle 切歌卡片），并在手机「电池优化」中将{' '}
              <span className="text-zinc-200">{config.appName}</span> 设为“不受限制”，即可确保长时间息屏听歌稳定不断流。
            </p>
          </section>
        )}
      </div>

      {/* Architecture Notes on YouTube Premium Safety */}
      <section className="bg-[#12141A] border border-white/[0.08] rounded-xl p-6 space-y-4">
        <h2 className="text-base font-semibold text-white">
          关于 YouTube Premium 会员权益与账号安全说明
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-xs text-zinc-400 leading-relaxed">
          <div className="space-y-1.5">
            <div className="text-sm font-medium text-zinc-100">1. 官方网页直连，零风控</div>
            <p>
              双端客户端本质是专为 <span className="font-mono text-zinc-300">{config.startUrl}</span> 优化的独立浏览器容器，不调用任何逆向破解 API，不会触发 YouTube 账号封禁风险。
            </p>
          </div>
          <div className="space-y-1.5">
            <div className="text-sm font-medium text-zinc-100">2. 完整享受会员高音质与免广告</div>
            <p>
              打开客户端后直接使用你的 Google 账号登录一次，即可自动同步所有已购 Premium 权益（无前贴片/插播广告、高码率音频流、已点赞与自建歌单云同步）。
            </p>
          </div>
          <div className="space-y-1.5">
            <div className="text-sm font-medium text-zinc-100">3. 彻底解决 PWA 痛点</div>
            <p>
              补齐了浏览器地址栏安装无法实现的 macOS 菜单栏托盘驻留、全局键盘媒体键接管、以及 Android 息屏前台服务保活与锁屏切歌。
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
