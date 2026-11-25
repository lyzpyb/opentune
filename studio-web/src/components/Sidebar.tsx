import {
  Play,
  Sliders,
  Code2,
  GitBranch,
  Package,
  ArrowLeft,
  X,
} from 'lucide-react';
import type { WorkspaceTab } from '../types/client';

interface SidebarProps {
  activeTab: WorkspaceTab;
  onSelectTab: (tab: WorkspaceTab) => void;
  onBackToHome: () => void;
  appName: string;
  bundleId: string;
  fileCount: number;
  hasConfigErrors: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

const NAV_ITEMS: Array<{
  id: WorkspaceTab;
  label: string;
  subtitle: string;
  icon: typeof Play;
}> = [
  {
    id: 'preview',
    label: '客户端预览与试听',
    subtitle: '网页接口测试与双端交互壳',
    icon: Play,
  },
  {
    id: 'config',
    label: '参数与权益配置',
    subtitle: 'UA 净化、Cookie 与后台保活',
    icon: Sliders,
  },
  {
    id: 'source',
    label: '源码工程浏览',
    subtitle: 'Electron DMG 与 Android APK',
    icon: Code2,
  },
  {
    id: 'github',
    label: 'GitHub 自动出包',
    subtitle: '连接仓库自动编译 .dmg / .apk',
    icon: GitBranch,
  },
  {
    id: 'guide',
    label: '打包与安装指南',
    subtitle: '本机构建命令与会员说明',
    icon: Package,
  },
];

export function Sidebar({
  activeTab,
  onSelectTab,
  onBackToHome,
  appName,
  bundleId,
  fileCount,
  hasConfigErrors,
  mobileOpen,
  onCloseMobile,
}: SidebarProps) {
  const handlePick = (tab: WorkspaceTab) => {
    onSelectTab(tab);
    onCloseMobile();
  };

  const navContent = (
    <div className="flex h-full flex-col bg-[#101218] border-r border-white/[0.08]">
      <div className="flex items-center justify-between px-5 h-16 border-b border-white/[0.08]">
        <button
          type="button"
          onClick={() => {
            onCloseMobile();
            onBackToHome();
          }}
          className="text-left focus-visible:outline-2 focus-visible:outline-offset-2 rounded-md cursor-pointer"
        >
          <span className="block text-[15px] font-semibold tracking-tight text-white whitespace-nowrap">
            {appName || 'OpenTune'} Studio
          </span>
        </button>
        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="关闭侧边导航栏"
          className="lg:hidden p-2 -mr-2 text-zinc-400 hover:text-white rounded-md transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="px-3 pt-4">
        <button
          type="button"
          onClick={() => {
            onCloseMobile();
            onBackToHome();
          }}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-zinc-300 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
          <span className="truncate">返回开源下载主页</span>
        </button>
      </div>

      <nav aria-label="主工作区导航" className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handlePick(item.id)}
              aria-current={isActive ? 'page' : undefined}
              className={`w-full flex items-start gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                isActive
                  ? 'bg-white/[0.08] text-white'
                  : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200'
              }`}
            >
              <Icon
                className={`w-4 h-4 mt-0.5 shrink-0 ${
                  isActive ? 'text-[#FF0033]' : 'text-zinc-500'
                }`}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-medium truncate">{item.label}</span>
                  {item.id === 'config' && hasConfigErrors && (
                    <span className="text-[11px] font-medium text-amber-400 shrink-0">
                      需修正
                    </span>
                  )}
                </span>
                <span className="block text-[11px] text-zinc-500 truncate mt-0.5">
                  {item.subtitle}
                </span>
              </span>
            </button>
          );
        })}
      </nav>

      <div className="px-5 py-4 border-t border-white/[0.08] space-y-1 text-xs text-zinc-400">
        <div className="font-medium text-zinc-200 truncate">{appName || '未命名客户端'}</div>
        <div className="font-mono text-[11px] text-zinc-500 truncate">{bundleId}</div>
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-zinc-500 pt-1.5 tabular-nums">
          <span className="whitespace-nowrap">macOS .dmg</span>
          <span aria-hidden="true">·</span>
          <span className="whitespace-nowrap">Android .apk</span>
          <span aria-hidden="true">·</span>
          <span className="whitespace-nowrap">{fileCount} 文件</span>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden lg:block w-[256px] shrink-0 h-screen sticky top-0">
        {navContent}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="w-[272px] max-w-[82vw] h-full">{navContent}</div>
          <button
            type="button"
            aria-label="关闭菜单遮罩"
            onClick={onCloseMobile}
            className="flex-1 bg-black/60 backdrop-blur-[2px]"
          />
        </div>
      )}
    </>
  );
}
