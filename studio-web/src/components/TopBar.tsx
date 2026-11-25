import { Download, Menu } from 'lucide-react';
import type { WorkspaceTab } from '../types/client';

interface TopBarProps {
  activeTab: WorkspaceTab;
  appName: string;
  onBackToHome: () => void;
  onOpenMobileMenu: () => void;
  onExportFullZip: () => void;
  isExporting: boolean;
  hasConfigErrors: boolean;
}

const TAB_TITLES: Record<WorkspaceTab, string> = {
  preview: '客户端预览与试听',
  config: '参数与权益配置',
  source: '源码工程浏览',
  github: 'GitHub 自动出包',
  guide: '打包与安装指南',
};

export function TopBar({
  activeTab,
  appName,
  onBackToHome,
  onOpenMobileMenu,
  onExportFullZip,
  isExporting,
  hasConfigErrors,
}: TopBarProps) {
  return (
    <header className="sticky top-0 z-30 h-16 bg-[#0B0C0F]/95 backdrop-blur-sm border-b border-white/[0.08] px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          aria-label="打开导航菜单"
          className="lg:hidden p-2 -ml-2 text-zinc-400 hover:text-white rounded-lg transition-colors"
        >
          <Menu className="w-5 h-5" />
        </button>

        <nav aria-label="面包屑导航" className="flex items-center gap-2 text-sm min-w-0">
          <button
            type="button"
            onClick={onBackToHome}
            className="text-zinc-500 hover:text-zinc-200 hidden sm:inline whitespace-nowrap shrink-0 transition-colors cursor-pointer"
          >
            {appName || 'OpenTune'} 开源主页
          </button>
          <span className="text-zinc-600 hidden sm:inline" aria-hidden="true">
            /
          </span>
          <span className="font-medium text-white truncate">
            {TAB_TITLES[activeTab]}
          </span>
        </nav>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        <button
          type="button"
          onClick={onExportFullZip}
          disabled={isExporting || hasConfigErrors}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#FF0033] hover:bg-[#E0002D] disabled:bg-zinc-800 disabled:text-zinc-500 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:cursor-not-allowed"
        >
          <Download className="w-3.5 h-3.5 shrink-0" />
          <span>{isExporting ? '正在打包…' : '导出完整工程 (.zip)'}</span>
        </button>
      </div>
    </header>
  );
}
