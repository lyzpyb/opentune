import { useMemo, useState } from 'react';
import { Copy, Check, Search, Download, FileCode2 } from 'lucide-react';
import type { FileTargetGroup, GeneratedFile } from '../types/client';

interface SourceInspectorViewProps {
  files: GeneratedFile[];
  onExportScope: (scope: 'all' | FileTargetGroup) => void;
  hasConfigErrors: boolean;
}

const FILTER_OPTIONS: Array<{ id: 'all' | FileTargetGroup; label: string }> = [
  { id: 'all', label: '全部文件' },
  { id: 'macos', label: 'macOS (.dmg)' },
  { id: 'android', label: 'Android (.apk)' },
  { id: 'ci', label: 'GitHub Actions 云端出包' },
];

export function SourceInspectorView({
  files,
  onExportScope,
  hasConfigErrors,
}: SourceInspectorViewProps) {
  const [targetFilter, setTargetFilter] = useState<'all' | FileTargetGroup>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPath, setSelectedPath] = useState<string>(files[0]?.path ?? '');
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  const filteredFiles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return files.filter((file) => {
      if (targetFilter !== 'all' && file.target !== targetFilter) return false;
      if (!q) return true;
      return (
        file.path.toLowerCase().includes(q) ||
        file.description.toLowerCase().includes(q)
      );
    });
  }, [files, targetFilter, searchQuery]);

  const activeFile =
    filteredFiles.find((f) => f.path === selectedPath) ?? filteredFiles[0] ?? null;

  const handleCopy = async (file: GeneratedFile) => {
    try {
      await navigator.clipboard.writeText(file.content);
      setCopiedPath(file.path);
      window.setTimeout(() => setCopiedPath(null), 1800);
    } catch {
      // Fallback ignored in restricted clipboard contexts
    }
  };

  const lines = activeFile ? activeFile.content.split('\n') : [];

  return (
    <div className="space-y-6">
      {/* Header & Target Filter */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 pb-5 border-b border-white/[0.08]">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            双端完整源码工程浏览
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            共生成 <span className="font-mono text-zinc-200 tabular-nums">{files.length}</span> 个可直接编译的源文件，已自动注入你的包名、入口链接与会员权益策略。
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div
            role="tablist"
            aria-label="按目标平台筛选源码"
            className="inline-flex flex-wrap items-center gap-1 p-1 bg-white/[0.04] border border-white/[0.06] rounded-lg"
          >
            {FILTER_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                role="tab"
                aria-selected={targetFilter === opt.id}
                onClick={() => setTargetFilter(opt.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  targetFilter === opt.id
                    ? 'bg-white/[0.12] text-white'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Split: File Tree + Code Viewer */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        {/* File List Sidebar */}
        <div className="lg:col-span-4 bg-[#12141A] border border-white/[0.08] rounded-xl flex flex-col overflow-hidden">
          <div className="p-3 border-b border-white/[0.08] space-y-2.5">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <label htmlFor="source-file-search" className="sr-only">
                搜索源码文件名或说明
              </label>
              <input
                id="source-file-search"
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="筛选文件名或功能关键字…"
                className="w-full pl-8 pr-3 py-1.5 text-xs text-zinc-100 bg-[#0B0C0F] border border-white/[0.09] rounded-lg focus:border-[#FF0033] focus:outline-none"
              />
            </div>

            <div className="flex items-center justify-between text-[11px] text-zinc-500 px-1 tabular-nums">
              <span>匹配 {filteredFiles.length} 个文件</span>
              <button
                type="button"
                disabled={hasConfigErrors}
                onClick={() => onExportScope(targetFilter)}
                className="inline-flex items-center gap-1 text-zinc-300 hover:text-white disabled:opacity-40 transition-colors cursor-pointer disabled:cursor-not-allowed"
              >
                <Download className="w-3 h-3" />
                <span>下载当前分组 (.zip)</span>
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto max-h-[580px] divide-y divide-white/[0.04]">
            {filteredFiles.length === 0 ? (
              <div className="p-8 text-center space-y-2">
                <p className="text-sm text-zinc-300">未找到匹配的源码文件</p>
                <p className="text-xs text-zinc-500">
                  尝试清除搜索词或切换至“全部文件”查看所有生成的工程代码。
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setTargetFilter('all');
                  }}
                  className="mt-2 px-3 py-1.5 text-xs font-medium text-white bg-white/[0.08] hover:bg-white/[0.14] rounded-md transition-colors cursor-pointer"
                >
                  重置筛选条件
                </button>
              </div>
            ) : (
              filteredFiles.map((file) => {
                const isSelected = activeFile?.path === file.path;
                const fileName = file.path.split('/').pop() ?? file.path;
                const dirPath = file.path.slice(0, file.path.length - fileName.length);
                return (
                  <button
                    key={file.path}
                    type="button"
                    onClick={() => setSelectedPath(file.path)}
                    className={`w-full text-left px-3.5 py-2.5 transition-colors flex items-start gap-2.5 cursor-pointer ${
                      isSelected
                        ? 'bg-white/[0.09] text-white'
                        : 'hover:bg-white/[0.04] text-zinc-300'
                    }`}
                  >
                    <FileCode2
                      className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${
                        isSelected ? 'text-[#FF0033]' : 'text-zinc-500'
                      }`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-mono font-medium truncate">
                        {fileName}
                      </span>
                      <span className="block text-[11px] font-mono text-zinc-500 truncate">
                        {dirPath || '/'}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Code Display Pane */}
        <div className="lg:col-span-8 bg-[#12141A] border border-white/[0.08] rounded-xl flex flex-col overflow-hidden">
          {activeFile ? (
            <>
              <div className="px-4 py-3 border-b border-white/[0.08] flex flex-wrap items-center justify-between gap-3 bg-white/[0.02]">
                <div className="min-w-0">
                  <div className="text-xs font-mono font-medium text-white truncate">
                    {activeFile.path}
                  </div>
                  <div className="text-[11px] text-zinc-400 mt-0.5 flex flex-wrap items-center gap-2">
                    <span>{activeFile.description}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">{lines.length} 行</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handleCopy(activeFile)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-200 bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.08] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {copiedPath === activeFile.path ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span>已复制</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>复制源码</span>
                    </>
                  )}
                </button>
              </div>

              <div className="flex-1 overflow-auto max-h-[580px] bg-[#090A0E] p-4">
                <pre className="text-xs font-mono leading-relaxed text-zinc-200 pr-6">
                  <code>
                    {lines.map((line, idx) => (
                      <div key={idx} className="table-row">
                        <span className="table-cell pr-4 text-right select-none text-zinc-600 tabular-nums w-9">
                          {idx + 1}
                        </span>
                        <span className="table-cell whitespace-pre pr-6">{line || ' '}</span>
                      </div>
                    ))}
                  </code>
                </pre>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center p-12 text-sm text-zinc-500">
              请从左侧列表选择任意工程文件查看完整代码。
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
