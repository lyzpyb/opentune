import { useCallback, useEffect, useState } from 'react';
import {
  GitBranch,
  ExternalLink,
  RefreshCw,
  UploadCloud,
  Download,
  Copy,
  Check,
  Play,
  Plus,
  LogOut,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import type {
  ClientConfig,
  GitHubRepoSummary,
  GitHubUser,
  GitHubWorkflowRun,
} from '../types/client';
import {
  formatBytes,
  formatWorkflowStatusLabel,
  validateNewRepoName,
} from '../utils/githubHelpers';

interface GitHubPipelineViewProps {
  config: ClientConfig;
  fileCount: number;
  hasConfigErrors: boolean;
  onExportFullZip: () => void;
  onRepoBound?: (repoFullName: string) => void;
}

interface OAuthServerConfig {
  oauthConfigured: boolean;
  callbackUrl: string;
  requiredScopes: string[];
  studioFileCount?: number;
}

interface DeployResult {
  commitSha: string;
  commitUrl: string;
  actionsUrl: string;
  releasesUrl: string;
  pagesUrl?: string;
  pagesEnabled?: boolean;
  pagesNote?: string;
  repoMetadataUpdated?: boolean;
  fileCount: number;
  studioFilesCount?: number;
}

export function GitHubPipelineView({
  config,
  fileCount,
  hasConfigErrors,
  onExportFullZip,
  onRepoBound,
}: GitHubPipelineViewProps) {
  const [serverCfg, setServerCfg] = useState<OAuthServerConfig | null>(null);
  const [loadingCfg, setLoadingCfg] = useState(true);
  // Server-issued opaque session token held strictly in React memory (never persisted to localStorage)
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [user, setUser] = useState<GitHubUser | null>(null);
  const [repos, setRepos] = useState<GitHubRepoSummary[]>([]);
  const [loadingProfile, setLoadingProfile] = useState(false);

  const [repoMode, setRepoMode] = useState<'create' | 'existing'>('existing');
  const [selectedRepoFull, setSelectedRepoFull] = useState<string>('');
  const [newRepoName, setNewRepoName] = useState<string>('opentune');
  const [newRepoPrivate, setNewRepoPrivate] = useState<boolean>(false);
  const [includeStudioSource, setIncludeStudioSource] = useState<boolean>(true);
  const [configureOpenSource, setConfigureOpenSource] = useState<boolean>(true);
  const [newRepoError, setNewRepoError] = useState<string | null>(null);

  const [deploying, setDeploying] = useState(false);
  const [deployResult, setDeployResult] = useState<DeployResult | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [runs, setRuns] = useState<GitHubWorkflowRun[]>([]);
  const [workflowMissing, setWorkflowMissing] = useState(false);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [downloadingArtifactId, setDownloadingArtifactId] = useState<number | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const selectedRepoObj = repos.find((r) => r.fullName === selectedRepoFull) ?? null;

  const copyValue = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(null), 1800);
    } catch {
      // Ignore clipboard error
    }
  };

  // Load server OAuth status
  useEffect(() => {
    let active = true;
    fetch('/api/github/config')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: OAuthServerConfig | null) => {
        if (active && data) setServerCfg(data);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoadingCfg(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // Load GitHub user & repos when sessionToken is received
  const fetchUserAndRepos = useCallback(async (token: string) => {
    setLoadingProfile(true);
    setActionError(null);
    try {
      const resp = await fetch('/api/github/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await resp.json();
      if (!resp.ok) {
        setActionError(data.error || '读取 GitHub 账号失败');
        if (resp.status === 401) {
          setSessionToken(null);
          setUser(null);
          setRepos([]);
        }
        return;
      }
      setUser(data.user);
      setRepos(data.repos ?? []);
      if (data.repos?.length > 0) {
        setSelectedRepoFull((prev) => prev || data.repos[0].fullName);
      }
    } catch {
      setActionError('连接后端接口失败，请稍后重试。');
    } finally {
      setLoadingProfile(false);
    }
  }, []);

  useEffect(() => {
    if (sessionToken) {
      fetchUserAndRepos(sessionToken);
    }
  }, [sessionToken, fetchUserAndRepos]);

  // Listen for OAuth popup postMessage completion
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const origin = event.origin;
      if (
        !origin.endsWith('.run.app') &&
        !origin.includes('localhost') &&
        origin !== window.location.origin
      ) {
        return;
      }
      if (event.data?.type === 'GITHUB_OAUTH_SUCCESS' && typeof event.data.sessionToken === 'string') {
        setActionError(null);
        setSessionToken(event.data.sessionToken);
      } else if (event.data?.type === 'GITHUB_OAUTH_ERROR') {
        setActionError(`GitHub 授权未完成：${String(event.data.error || '请重试')}`);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const fetchRuns = useCallback(
    async (owner: string, repo: string, token: string) => {
      setLoadingRuns(true);
      try {
        const resp = await fetch(
          `/api/github/runs?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const data = await resp.json();
        if (resp.ok) {
          setRuns(data.runs ?? []);
          setWorkflowMissing(Boolean(data.workflowMissing));
        }
      } catch {
        // Ignore transient poll errors
      } finally {
        setLoadingRuns(false);
      }
    },
    []
  );

  // Poll runs when a repo is selected or actively building
  useEffect(() => {
    if (!sessionToken || !selectedRepoObj) return;
    fetchRuns(selectedRepoObj.owner, selectedRepoObj.name, sessionToken);
  }, [sessionToken, selectedRepoObj, fetchRuns]);

  useEffect(() => {
    if (!sessionToken || !selectedRepoObj) return;
    const hasActiveRun = runs.some(
      (r) => r.status === 'queued' || r.status === 'in_progress' || r.status === 'waiting'
    );
    if (!hasActiveRun) return;

    const interval = window.setInterval(() => {
      fetchRuns(selectedRepoObj.owner, selectedRepoObj.name, sessionToken);
    }, 12000);
    return () => window.clearInterval(interval);
  }, [runs, sessionToken, selectedRepoObj, fetchRuns]);

  const handleConnectGitHub = async () => {
    setActionError(null);
    try {
      const resp = await fetch('/api/github/auth/url');
      const data = await resp.json();
      if (!resp.ok || !data.url) {
        setActionError(data.error || '无法获取 GitHub OAuth 授权地址。');
        return;
      }
      const popup = window.open(data.url, 'github_oauth_popup', 'width=640,height=740');
      if (!popup) {
        setActionError('浏览器拦截了授权弹窗，请允许当前页面弹出窗口后再点击连接。');
      }
    } catch {
      setActionError('请求 GitHub OAuth 地址失败，请稍后重试。');
    }
  };

  const handleDisconnect = async () => {
    if (sessionToken) {
      await fetch('/api/github/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${sessionToken}` },
      }).catch(() => {});
    }
    setSessionToken(null);
    setUser(null);
    setRepos([]);
    setSelectedRepoFull('');
    setRuns([]);
    setDeployResult(null);
    setActionError(null);
  };

  const handleDeployAndBuild = async () => {
    if (!sessionToken || hasConfigErrors) return;
    setActionError(null);
    setDeployResult(null);

    let targetRepo = selectedRepoObj;

    if (repoMode === 'create') {
      const validationErr = validateNewRepoName(newRepoName);
      if (validationErr) {
        setNewRepoError(validationErr);
        return;
      }
      setNewRepoError(null);
    } else if (!targetRepo) {
      setActionError('请先选择一个目标 GitHub 仓库。');
      return;
    }

    setDeploying(true);
    try {
      if (repoMode === 'create') {
        const createResp = await fetch('/api/github/repos', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${sessionToken}`,
          },
          body: JSON.stringify({
            name: newRepoName.trim(),
            private: newRepoPrivate,
            description: `${config.appName} — YouTube Music macOS (.dmg) & Android (.apk) native client`,
          }),
        });
        const createData = await createResp.json();
        if (!createResp.ok || !createData.repo) {
          setActionError(createData.error || '创建 GitHub 仓库失败。');
          return;
        }
        targetRepo = createData.repo as GitHubRepoSummary;
        setRepos((prev) => [targetRepo!, ...prev]);
        setSelectedRepoFull(targetRepo.fullName);
        setRepoMode('existing');
      }

      if (!targetRepo) return;

      const deployResp = await fetch('/api/github/deploy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({
          owner: targetRepo.owner,
          repo: targetRepo.name,
          branch: targetRepo.defaultBranch || 'main',
          includeStudioSource,
          configureOpenSource,
          makePublic: configureOpenSource && (repoMode === 'existing' ? true : !newRepoPrivate),
          config,
        }),
      });
      const deployData = await deployResp.json();
      if (!deployResp.ok) {
        setActionError(deployData.error || '推送工程源码至 GitHub 失败。');
        return;
      }

      setDeployResult(deployData as DeployResult);
      onRepoBound?.(targetRepo.fullName);
      window.setTimeout(() => {
        if (targetRepo) {
          fetchRuns(targetRepo.owner, targetRepo.name, sessionToken);
        }
      }, 2500);
    } catch {
      setActionError('部署过程发生网络错误，请稍后重试。');
    } finally {
      setDeploying(false);
    }
  };

  const handleManualDispatch = async () => {
    if (!sessionToken || !selectedRepoObj) return;
    setDispatching(true);
    setActionError(null);
    try {
      const resp = await fetch('/api/github/dispatch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({
          owner: selectedRepoObj.owner,
          repo: selectedRepoObj.name,
          branch: selectedRepoObj.defaultBranch || 'main',
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setActionError(data.error || '手动触发构建失败。');
        return;
      }
      window.setTimeout(() => {
        fetchRuns(selectedRepoObj.owner, selectedRepoObj.name, sessionToken);
      }, 2000);
    } catch {
      setActionError('触发云端打包时出现网络错误。');
    } finally {
      setDispatching(false);
    }
  };

  const handleDownloadArtifact = async (artifactId: number, artifactName: string) => {
    if (!sessionToken || !selectedRepoObj) return;
    setDownloadingArtifactId(artifactId);
    setActionError(null);
    try {
      const resp = await fetch(
        `/api/github/artifacts/${encodeURIComponent(selectedRepoObj.owner)}/${encodeURIComponent(
          selectedRepoObj.name
        )}/${artifactId}/download`,
        {
          headers: { Authorization: `Bearer ${sessionToken}` },
        }
      );
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        setActionError(err.error || '下载构建产物失败。');
        return;
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${artifactName}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch {
      setActionError('下载产物时发生网络异常。');
    } finally {
      setDownloadingArtifactId(null);
    }
  };

  const callbackUrlDisplay =
    serverCfg?.callbackUrl || `${window.location.origin}/auth/github/callback`;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-6 border-b border-white/[0.08]">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
            <span>GitHub OAuth 授权连接</span>
            <span aria-hidden="true">·</span>
            <span>自动推送 {fileCount} 个工程文件</span>
            <span aria-hidden="true">·</span>
            <span>并行产出 .dmg + .apk 并发布 Release</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-white mt-1.5">
            GitHub 仓库绑定与自动打包流水线
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            连接你的 GitHub 账号后，可一键新建或选择私有仓库、原子提交完整双端源码并启动 GitHub Actions 云端并行编译，构建完成后直接在此下载 .dmg 与 .apk。
          </p>
        </div>

        {user && (
          <div className="flex items-center gap-3 shrink-0">
            <a
              href={user.htmlUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 text-xs text-zinc-200 hover:text-white"
            >
              <img
                src={user.avatarUrl}
                alt={user.login}
                referrerPolicy="no-referrer"
                className="w-6 h-6 rounded-full border border-white/[0.12]"
              />
              <span className="font-mono">@{user.login}</span>
            </a>
            <button
              type="button"
              onClick={handleDisconnect}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-400 hover:text-white bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] rounded-lg transition-colors cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>断开连接</span>
            </button>
          </div>
        )}
      </div>

      {actionError && (
        <div
          role="alert"
          className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-200 flex items-start gap-2.5"
        >
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <span>{actionError}</span>
        </div>
      )}

      {/* Step 1: GitHub OAuth Connection */}
      <section className="bg-[#12141A] border border-white/[0.08] rounded-xl p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-white">01. 连接 GitHub 账号</h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              使用标准 GitHub OAuth 授权（权限范围 <span className="font-mono text-zinc-300">repo, workflow</span>），令牌仅保存在服务端内存会话中。
            </p>
          </div>

          {!user && (
            <button
              type="button"
              onClick={handleConnectGitHub}
              disabled={loadingCfg || !serverCfg?.oauthConfigured}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold text-[#0B0C0F] bg-white hover:bg-zinc-200 disabled:bg-zinc-800 disabled:text-zinc-500 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:cursor-not-allowed"
            >
              <GitBranch className="w-3.5 h-3.5" />
              <span>{loadingCfg ? '检查服务配置…' : '连接 GitHub 账号'}</span>
            </button>
          )}
        </div>

        {!loadingCfg && serverCfg && !serverCfg.oauthConfigured && (
          <div className="bg-[#0B0C0F] border border-white/[0.08] rounded-lg p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-medium text-amber-300">
                需先配置 GitHub OAuth App 凭据以启用一键直连推送
              </div>
              <a
                href="https://github.com/settings/developers"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-zinc-300 hover:text-white underline underline-offset-4"
              >
                <span>前往 GitHub Developer Settings</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            <ol className="space-y-2.5 text-xs text-zinc-300 list-decimal list-inside leading-relaxed">
              <li>
                打开 GitHub 开发者设置，点击 <strong>OAuth Apps → New OAuth App</strong>，<strong>Homepage URL</strong> 可填当前应用地址。
              </li>
              <li>
                将 <strong>Redirect URIs</strong>（原 Authorization callback URL）填写为下方回调地址（其余复选框如 Wildcard / Device Flow / Expire tokens 保持不勾选）：
              </li>
              <li>
                点击 <strong>Register application</strong> 创建后，在详情页复制 <strong>Client ID</strong> 并点击 <strong>Generate a new client secret</strong> 获取密钥，填入 AI Studio 的 Secrets：{' '}
                <span className="font-mono text-white">GITHUB_CLIENT_ID</span> 与{' '}
                <span className="font-mono text-white">GITHUB_CLIENT_SECRET</span>。
              </li>
            </ol>

            <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 bg-[#12141A] border border-white/[0.08] rounded-lg">
              <code className="text-xs font-mono text-zinc-200 truncate">
                {callbackUrlDisplay}
              </code>
              <button
                type="button"
                onClick={() => copyValue('cb', callbackUrlDisplay)}
                className="inline-flex items-center gap-1.5 text-xs text-zinc-300 hover:text-white whitespace-nowrap shrink-0 cursor-pointer"
              >
                {copiedKey === 'cb' ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span>已复制</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>复制回调地址</span>
                  </>
                )}
              </button>
            </div>

            <div className="pt-2 border-t border-white/[0.07] flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-400">
              <span>也可以先导出完整工程 .zip（已含自动发布 Release 的 GitHub Actions 工作流），手动 git push 触发编译。</span>
              <button
                type="button"
                disabled={hasConfigErrors}
                onClick={onExportFullZip}
                className="text-zinc-200 hover:text-white underline underline-offset-4 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-40"
              >
                先导出完整工程 (.zip)
              </button>
            </div>
          </div>
        )}

        {user && (
          <div className="pt-3 border-t border-white/[0.07] flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-300">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>
                已授权连接 GitHub 账号 <strong className="font-mono text-white">@{user.login}</strong>，已读取{' '}
                <span className="font-mono tabular-nums text-white">{repos.length}</span> 个可写仓库。
              </span>
            </div>
            <button
              type="button"
              onClick={() => sessionToken && fetchUserAndRepos(sessionToken)}
              disabled={loadingProfile}
              className="inline-flex items-center gap-1.5 text-zinc-400 hover:text-white cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingProfile ? 'animate-spin' : ''}`} />
              <span>刷新仓库列表</span>
            </button>
          </div>
        )}
      </section>

      {/* Step 2: Repository Binding & Atomic Push */}
      <section className="bg-[#12141A] border border-white/[0.08] rounded-xl p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-white">02. 绑定目标仓库并推送双端工程</h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              一次性提交 macOS Electron 工程、Android Kotlin 工程与 <span className="font-mono text-zinc-300">.github/workflows/build-clients.yml</span>
            </p>
          </div>

          <div
            role="tablist"
            aria-label="选择新建或已有仓库"
            className="inline-flex items-center gap-1 p-1 bg-white/[0.04] border border-white/[0.06] rounded-lg"
          >
            <button
              type="button"
              role="tab"
              aria-selected={repoMode === 'create'}
              onClick={() => setRepoMode('create')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                repoMode === 'create'
                  ? 'bg-white/[0.12] text-white'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Plus className="w-3.5 h-3.5" />
              <span>新建私有仓库</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={repoMode === 'existing'}
              onClick={() => setRepoMode('existing')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                repoMode === 'existing'
                  ? 'bg-white/[0.12] text-white'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              绑定已有仓库
            </button>
          </div>
        </div>

        {repoMode === 'create' ? (
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
            <div className="md:col-span-6 space-y-1.5">
              <label htmlFor="gh-new-repo" className="block text-xs font-medium text-zinc-300">
                新仓库名称
              </label>
              <input
                id="gh-new-repo"
                type="text"
                value={newRepoName}
                onChange={(e) => {
                  setNewRepoName(e.target.value);
                  if (newRepoError) setNewRepoError(null);
                }}
                placeholder="ytm-native-client"
                className="w-full px-3.5 py-2 text-sm font-mono text-white bg-[#0B0C0F] border border-white/[0.1] rounded-lg focus:border-[#FF0033] focus:outline-none"
              />
              {newRepoError ? (
                <p className="text-xs text-red-400">{newRepoError}</p>
              ) : (
                <p className="text-[11px] text-zinc-500">
                  开源发布推荐选择 Public 公开仓库，以便自动启用免费 GitHub Pages 官网与 Releases 直接下载
                </p>
              )}
            </div>

            <div className="md:col-span-6 space-y-1.5">
              <span className="block text-xs font-medium text-zinc-300">仓库可见性</span>
              <div className="flex items-center gap-4 pt-1.5 text-xs text-zinc-300">
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="repo-visibility"
                    checked={!newRepoPrivate}
                    onChange={() => setNewRepoPrivate(false)}
                    className="accent-[#FF0033]"
                  />
                  <span>Public 公开开源（推荐）</span>
                </label>
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="repo-visibility"
                    checked={newRepoPrivate}
                    onChange={() => setNewRepoPrivate(true)}
                    className="accent-[#FF0033]"
                  />
                  <span>Private 私有仓库</span>
                </label>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-1.5 max-w-xl">
            <label htmlFor="gh-existing-repo" className="block text-xs font-medium text-zinc-300">
              选择已有仓库
            </label>
            <select
              id="gh-existing-repo"
              value={selectedRepoFull}
              onChange={(e) => setSelectedRepoFull(e.target.value)}
              disabled={!user || repos.length === 0}
              className="w-full px-3.5 py-2 text-sm font-mono text-white bg-[#0B0C0F] border border-white/[0.1] rounded-lg focus:border-[#FF0033] focus:outline-none disabled:opacity-50"
            >
              {repos.length === 0 ? (
                <option value="">请先连接 GitHub 账号以加载仓库列表</option>
              ) : (
                repos.map((r) => (
                  <option key={r.id} value={r.fullName}>
                    {r.fullName} ({r.private ? 'Private' : 'Public'} · {r.defaultBranch})
                  </option>
                ))
              )}
            </select>
          </div>
        )}

        <div className="pt-4 border-t border-white/[0.07] space-y-4">
          <label className="flex items-start gap-2.5 text-xs text-zinc-300 cursor-pointer">
            <input
              type="checkbox"
              checked={includeStudioSource}
              onChange={(e) => setIncludeStudioSource(e.target.checked)}
              className="mt-0.5 accent-[#FF0033] rounded"
            />
            <span className="leading-relaxed">
              <strong className="text-zinc-100 font-medium">
                同时推送当前工坊完整源码（写入仓库 <span className="font-mono">studio-web/</span> 目录）
              </strong>
              <span className="block text-[11px] text-zinc-500 mt-0.5 tabular-nums">
                包含当前 Web 端与 Express 服务端全部源码（约 {serverCfg?.studioFileCount ?? 20} 个文件，自动排除本地密钥与 node_modules），与 macOS / Android 打包目录互不干扰。
              </span>
            </span>
          </label>

          <label className="flex items-start gap-2.5 text-xs text-zinc-300 cursor-pointer">
            <input
              type="checkbox"
              checked={configureOpenSource}
              onChange={(e) => setConfigureOpenSource(e.target.checked)}
              className="mt-0.5 accent-[#FF0033] rounded"
            />
            <span className="leading-relaxed">
              <strong className="text-zinc-100 font-medium">
                自动完成开源仓库配置并启用 GitHub Pages 静态官网（<span className="font-mono">/docs</span>）
              </strong>
              <span className="block text-[11px] text-zinc-500 mt-0.5">
                推送时自动通过 GitHub API 将仓库设为 Public、写入开源简介与官网链接、添加 Topics 标签，并自动开启 GitHub Pages 发布下载主页。
              </span>
            </span>
          </label>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="text-xs text-zinc-400 space-y-0.5">
              <div>
                待推送配置：<span className="text-zinc-200 font-medium">{config.appName}</span> ·{' '}
                <span className="font-mono text-zinc-300">{config.bundleId}</span> ·{' '}
                <span className="font-mono text-zinc-300">v{config.version}</span>
              </div>
              <div className="text-[11px] text-zinc-500">
                推送后自动更新 README / LICENSE / 官网、开启 GitHub Pages 并编译 .dmg + .apk 发布至 Releases
              </div>
            </div>

            <button
              type="button"
              disabled={!user || deploying || hasConfigErrors}
              onClick={handleDeployAndBuild}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-[#FF0033] hover:bg-[#E0002D] disabled:bg-zinc-800/70 disabled:text-zinc-500 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:cursor-not-allowed"
            >
              {deploying ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>正在更新仓库与配置 Pages…</span>
                </>
              ) : (
                <>
                  <UploadCloud className="w-3.5 h-3.5" />
                  <span>一键更新仓库、开启 Pages 并打包</span>
                </>
              )}
            </button>
          </div>
        </div>

        {deployResult && (
          <div className="px-4 py-3.5 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-xs text-emerald-200 space-y-2">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                已原子提交 <span className="font-mono font-semibold">{deployResult.fileCount}</span> 个文件
                {deployResult.studioFilesCount
                  ? `（含 studio-web/ 工坊源码 ${deployResult.studioFilesCount} 个文件）`
                  : ''}
                （Commit <span className="font-mono">{deployResult.commitSha.slice(0, 7)}</span>）
                {deployResult.repoMetadataUpdated ? '，已同步仓库简介与 Topics' : ''}
                {deployResult.pagesEnabled ? '，GitHub Pages 静态官网已自动开启' : ''}。
              </div>
              <div className="flex flex-wrap items-center gap-3 shrink-0">
                {deployResult.pagesUrl && (
                  <a
                    href={deployResult.pagesUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-semibold text-white hover:text-emerald-200 underline underline-offset-2"
                  >
                    <span>打开 GitHub Pages 官网</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
                <a
                  href={deployResult.actionsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-emerald-300 hover:text-white underline underline-offset-2"
                >
                  <span>查看构建日志</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
                <a
                  href={deployResult.releasesUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-emerald-300 hover:text-white underline underline-offset-2"
                >
                  <span>Releases 直下页</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
            {deployResult.pagesNote && (
              <div className="text-[11px] text-amber-200/90">{deployResult.pagesNote}</div>
            )}
          </div>
        )}
      </section>

      {/* Step 3: Live Actions Build Monitor & Direct Artifact Downloads */}
      <section className="bg-[#12141A] border border-white/[0.08] rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-white/[0.08] flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-white">03. 云端构建状态与安装包下载</h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              {selectedRepoObj
                ? `正在监控 ${selectedRepoObj.fullName} 的 build-clients.yml 工作流（编译中每 12 秒自动刷新）`
                : '连接账号并绑定仓库后，实时显示 macOS (.dmg) 与 Android (.apk) 云端编译进度与产物下载'}
            </p>
          </div>

          {user && selectedRepoObj && (
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={dispatching || workflowMissing}
                onClick={handleManualDispatch}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-200 bg-white/[0.06] hover:bg-white/[0.12] disabled:opacity-40 border border-white/[0.08] rounded-lg transition-colors whitespace-nowrap cursor-pointer disabled:cursor-not-allowed"
              >
                <Play className="w-3 h-3" />
                <span>{dispatching ? '触发中…' : '手动重跑打包'}</span>
              </button>
              <button
                type="button"
                disabled={loadingRuns}
                onClick={() =>
                  sessionToken && fetchRuns(selectedRepoObj.owner, selectedRepoObj.name, sessionToken)
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:text-white bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] rounded-lg transition-colors whitespace-nowrap cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingRuns ? 'animate-spin' : ''}`} />
                <span>刷新状态</span>
              </button>
            </div>
          )}
        </div>

        <div className="p-6">
          {!user ? (
            <div className="py-8 text-center space-y-2">
              <p className="text-sm text-zinc-300">尚未连接 GitHub 账号</p>
              <p className="text-xs text-zinc-500">
                完成上方第 01 步授权后，即可在此一键推送工程并直接下载云端编译生成的 .dmg 与 .apk 安装包。
              </p>
            </div>
          ) : !selectedRepoObj ? (
            <div className="py-8 text-center space-y-2">
              <p className="text-sm text-zinc-300">尚未绑定目标仓库</p>
              <p className="text-xs text-zinc-500">
                在上方第 02 步点击「推送源码并自动打包 .dmg + .apk」创建或绑定仓库。
              </p>
            </div>
          ) : workflowMissing || runs.length === 0 ? (
            <div className="py-8 text-center space-y-2">
              <p className="text-sm text-zinc-300">
                {workflowMissing
                  ? '该仓库尚未推送 build-clients.yml 自动打包工作流'
                  : '暂无构建记录'}
              </p>
              <p className="text-xs text-zinc-500">
                点击第 02 步的「推送源码并自动打包 .dmg + .apk」即可自动写入工作流并启动首次编译。
              </p>
            </div>
          ) : (
            <div className="divide-y divide-white/[0.06]">
              {runs.map((run) => {
                const statusInfo = formatWorkflowStatusLabel(run.status, run.conclusion);
                const toneColor =
                  statusInfo.tone === 'success'
                    ? 'text-emerald-400'
                    : statusInfo.tone === 'error'
                      ? 'text-red-400'
                      : statusInfo.tone === 'running'
                        ? 'text-amber-300'
                        : 'text-zinc-400';

                return (
                  <div
                    key={run.id}
                    className="py-4 first:pt-0 last:pb-0 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-mono font-semibold text-white tabular-nums">
                          #{run.runNumber}
                        </span>
                        <span aria-hidden="true" className="text-zinc-600">
                          ·
                        </span>
                        <span className={`font-medium ${toneColor}`}>{statusInfo.label}</span>
                        <span aria-hidden="true" className="text-zinc-600">
                          ·
                        </span>
                        <span className="font-mono text-zinc-400">
                          {run.headBranch}@{run.headSha}
                        </span>
                      </div>
                      <div className="text-[11px] font-mono text-zinc-500 tabular-nums">
                        更新于 {new Date(run.updatedAt).toLocaleString('zh-CN')}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {run.artifacts.map((art) => (
                        <button
                          key={art.id}
                          type="button"
                          disabled={art.expired || downloadingArtifactId === art.id}
                          onClick={() => handleDownloadArtifact(art.id, art.name)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-white/[0.08] hover:bg-white/[0.15] disabled:opacity-40 border border-white/[0.1] rounded-lg transition-colors whitespace-nowrap cursor-pointer disabled:cursor-not-allowed"
                        >
                          <Download className="w-3.5 h-3.5 text-[#FF0033]" />
                          <span>{art.name}</span>
                          <span className="text-[11px] font-mono text-zinc-400 tabular-nums">
                            ({formatBytes(art.sizeInBytes)})
                          </span>
                        </button>
                      ))}

                      <a
                        href={run.htmlUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs text-zinc-400 hover:text-white transition-colors whitespace-nowrap"
                      >
                        <span>日志</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
