import { useEffect, useMemo, useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { OpenSourceHomeView } from './components/OpenSourceHomeView';
import { LivePreviewView } from './components/LivePreviewView';
import { ConfigView } from './components/ConfigView';
import { SourceInspectorView } from './components/SourceInspectorView';
import { GitHubPipelineView } from './components/GitHubPipelineView';
import { BuildGuideView } from './components/BuildGuideView';
import {
  DEFAULT_CLIENT_CONFIG,
  type ClientConfig,
  type WorkspaceTab,
} from './types/client';
import { generateClientProjectFiles } from './utils/clientGenerator';
import { hasValidationErrors, validateClientConfig } from './utils/ytmUrlParser';
import { exportClientZip, type ExportScope } from './utils/zipExporter';

const STORAGE_KEY = 'opentune_studio_config_v2';

function loadInitialConfig(): ClientConfig {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CLIENT_CONFIG;
    const parsed = JSON.parse(raw) as Partial<ClientConfig>;
    return { ...DEFAULT_CLIENT_CONFIG, ...parsed };
  } catch {
    return DEFAULT_CLIENT_CONFIG;
  }
}

export default function App() {
  const [viewMode, setViewMode] = useState<'home' | 'studio'>('home');
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('github');
  const [config, setConfig] = useState<ClientConfig>(loadInitialConfig);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch {
      // Ignore storage quota errors
    }
  }, [config]);

  const configErrors = useMemo(() => validateClientConfig(config), [config]);
  const hasErrors = hasValidationErrors(configErrors);
  const generatedFiles = useMemo(() => generateClientProjectFiles(config), [config]);

  const handleUpdateConfig = (patch: Partial<ClientConfig>) => {
    setConfig((prev) => ({ ...prev, ...patch }));
  };

  const handleResetConfig = () => {
    setConfig(DEFAULT_CLIENT_CONFIG);
  };

  const handleOpenStudio = (tab: WorkspaceTab = 'github') => {
    setActiveTab(tab);
    setViewMode('studio');
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  const handleExport = async (scope: ExportScope) => {
    if (hasErrors || isExporting) return;
    setIsExporting(true);
    try {
      const result = await exportClientZip(config, scope);
      setExportNotice(`已生成并开始下载 ${result.fileName}（包含 ${result.fileCount} 个工程文件）`);
      window.setTimeout(() => setExportNotice(null), 4500);
    } catch {
      setExportNotice('导出工程压缩包失败，请重试。');
    } finally {
      setIsExporting(false);
    }
  };

  if (viewMode === 'home') {
    return (
      <>
        {exportNotice && (
          <div
            role="status"
            aria-live="polite"
            className="fixed bottom-5 right-5 z-50 max-w-md px-4 py-3 rounded-lg bg-[#12141B] border border-emerald-500/35 text-xs text-emerald-200 shadow-2xl flex items-center justify-between gap-3"
          >
            <span>{exportNotice}</span>
            <button
              type="button"
              onClick={() => setExportNotice(null)}
              className="text-emerald-300 hover:text-white underline underline-offset-2 shrink-0 cursor-pointer"
            >
              关闭
            </button>
          </div>
        )}
        <OpenSourceHomeView
          config={config}
          generatedFiles={generatedFiles}
          hasConfigErrors={hasErrors}
          onUpdateConfig={handleUpdateConfig}
          onOpenStudio={handleOpenStudio}
          onExportFullZip={() => handleExport('all')}
        />
      </>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B0C0F] text-[#F3F4F6] flex">
      <Sidebar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onBackToHome={() => {
          setViewMode('home');
          window.scrollTo({ top: 0, behavior: 'instant' });
        }}
        appName={config.appName}
        bundleId={config.bundleId}
        fileCount={generatedFiles.length}
        hasConfigErrors={hasErrors}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      <div className="flex-1 min-w-0 flex flex-col">
        <TopBar
          activeTab={activeTab}
          appName={config.appName}
          onBackToHome={() => {
            setViewMode('home');
            window.scrollTo({ top: 0, behavior: 'instant' });
          }}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
          onExportFullZip={() => handleExport('all')}
          isExporting={isExporting}
          hasConfigErrors={hasErrors}
        />

        {exportNotice && (
          <div
            role="status"
            aria-live="polite"
            className="mx-4 sm:mx-6 lg:mx-8 mt-4 px-4 py-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-xs text-emerald-200 flex items-center justify-between gap-3"
          >
            <span>{exportNotice}</span>
            <button
              type="button"
              onClick={() => setExportNotice(null)}
              className="text-emerald-300 hover:text-white underline underline-offset-2 shrink-0 cursor-pointer"
            >
              关闭
            </button>
          </div>
        )}

        <main className="flex-1 w-full max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
          {activeTab === 'preview' && (
            <LivePreviewView
              config={config}
              onNavigateTab={setActiveTab}
              onExportTarget={(scope) => handleExport(scope)}
              hasConfigErrors={hasErrors}
            />
          )}

          {activeTab === 'config' && (
            <ConfigView
              config={config}
              errors={configErrors}
              onUpdate={handleUpdateConfig}
              onReset={handleResetConfig}
              onNavigateTab={setActiveTab}
            />
          )}

          {activeTab === 'source' && (
            <SourceInspectorView
              files={generatedFiles}
              onExportScope={(scope) => handleExport(scope)}
              hasConfigErrors={hasErrors}
            />
          )}

          {activeTab === 'github' && (
            <GitHubPipelineView
              config={config}
              fileCount={generatedFiles.length}
              hasConfigErrors={hasErrors}
              onExportFullZip={() => handleExport('all')}
              onRepoBound={(repoFull) => handleUpdateConfig({ githubRepo: repoFull })}
            />
          )}

          {activeTab === 'guide' && (
            <BuildGuideView
              config={config}
              onExportFullZip={() => handleExport('all')}
              hasConfigErrors={hasErrors}
            />
          )}
        </main>
      </div>
    </div>
  );
}
