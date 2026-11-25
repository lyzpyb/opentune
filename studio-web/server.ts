import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type Request, type Response } from 'express';
import { createServer as createViteServer } from 'vite';
import type { ClientConfig } from './src/types/client';
import { generateClientProjectFiles } from './src/utils/clientGenerator';
import { hasValidationErrors, validateClientConfig } from './src/utils/ytmUrlParser';
import {
  buildGitHubAuthorizeUrl,
  isValidGitHubBranch,
  isValidGitHubSegment,
  validateNewRepoName,
} from './src/utils/githubHelpers';
import { collectStudioWorkspaceFiles, type WorkspaceBlobFile } from './src/utils/workspaceCollector';

const PORT = 3000;
const GITHUB_API_BASE = 'https://api.github.com';
const STATE_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

interface PendingState {
  createdAt: number;
}

interface GitHubSession {
  accessToken: string;
  createdAt: number;
}

const pendingStates = new Map<string, PendingState>();
const sessions = new Map<string, GitHubSession>();

function cleanupExpiredMaps(): void {
  const now = Date.now();
  for (const [k, v] of pendingStates.entries()) {
    if (now - v.createdAt > STATE_TTL_MS) pendingStates.delete(k);
  }
  for (const [k, v] of sessions.entries()) {
    if (now - v.createdAt > SESSION_TTL_MS) sessions.delete(k);
  }
}

function getAppBaseUrl(): string {
  const raw = (process.env.APP_URL || '').trim();
  if (raw && raw !== 'MY_APP_URL') {
    return raw.replace(/\/+$/, '');
  }
  return `http://localhost:${PORT}`;
}

function getCallbackUrl(): string {
  return `${getAppBaseUrl()}/auth/github/callback`;
}

function isOAuthConfigured(): boolean {
  const id = (process.env.GITHUB_CLIENT_ID || '').trim();
  const secret = (process.env.GITHUB_CLIENT_SECRET || '').trim();
  return Boolean(id && secret);
}

function getSessionFromRequest(req: Request): GitHubSession | null {
  cleanupExpiredMaps();
  const authHeader = req.header('authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  if (!token) return null;
  return sessions.get(token) ?? null;
}

async function githubApiFetch(
  apiPath: string,
  accessToken: string,
  options: {
    method?: string;
    body?: unknown;
  } = {}
): Promise<globalThis.Response> {
  const url = `${GITHUB_API_BASE}${apiPath}`;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${accessToken}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'YTM-Native-Studio',
  };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  return fetch(url, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
}

function renderPopupHtml(payload: Record<string, unknown>, message: string): string {
  const safePayload = JSON.stringify(payload).replace(/</g, '\\u003c');
  const safeMsg = message
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>GitHub 授权回调</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #0B0C0F; color: #F3F4F6; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 24px; text-align: center; }
    p { font-size: 14px; color: #D4D4D8; }
  </style>
</head>
<body>
  <p>${safeMsg}</p>
  <script>
    (function() {
      var data = ${safePayload};
      if (window.opener) {
        window.opener.postMessage(data, '*');
        window.close();
      } else {
        window.location.href = '/';
      }
    })();
  </script>
</body>
</html>`;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  // 1. Public OAuth status & callback URL info (never leaks secrets)
  app.get('/api/github/config', (_req: Request, res: Response) => {
    let studioFileCount = 0;
    try {
      studioFileCount = collectStudioWorkspaceFiles(process.cwd()).length;
    } catch {
      studioFileCount = 0;
    }
    res.json({
      oauthConfigured: isOAuthConfigured(),
      callbackUrl: getCallbackUrl(),
      requiredScopes: ['repo', 'workflow'],
      studioFileCount,
    });
  });

  // 2. Construct GitHub OAuth authorization URL for direct popup open
  app.get('/api/github/auth/url', (_req: Request, res: Response) => {
    if (!isOAuthConfigured()) {
      res.status(503).json({
        error: '尚未在服务端环境变量中配置 GITHUB_CLIENT_ID 与 GITHUB_CLIENT_SECRET。',
      });
      return;
    }
    cleanupExpiredMaps();
    const state = crypto.randomBytes(24).toString('hex');
    pendingStates.set(state, { createdAt: Date.now() });

    const url = buildGitHubAuthorizeUrl({
      clientId: process.env.GITHUB_CLIENT_ID!.trim(),
      redirectUri: getCallbackUrl(),
      state,
    });
    res.json({ url });
  });

  // 3. OAuth callback handler (supports optional trailing slash)
  const handleOAuthCallback = async (req: Request, res: Response) => {
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const oauthError = typeof req.query.error === 'string' ? req.query.error : '';

    if (oauthError) {
      res.status(400).send(
        renderPopupHtml(
          { type: 'GITHUB_OAUTH_ERROR', error: oauthError },
          'GitHub 授权已取消或失败，窗口即将关闭。'
        )
      );
      return;
    }

    if (!code || !state || !pendingStates.has(state)) {
      res.status(400).send(
        renderPopupHtml(
          { type: 'GITHUB_OAUTH_ERROR', error: 'invalid_state' },
          '授权状态校验失败或已过期，请返回页面重新点击连接。'
        )
      );
      return;
    }

    pendingStates.delete(state);

    if (!isOAuthConfigured()) {
      res.status(503).send(
        renderPopupHtml(
          { type: 'GITHUB_OAUTH_ERROR', error: 'server_not_configured' },
          '服务端 OAuth 凭据未配置。'
        )
      );
      return;
    }

    try {
      const tokenResp = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': 'YTM-Native-Studio',
        },
        body: JSON.stringify({
          client_id: process.env.GITHUB_CLIENT_ID!.trim(),
          client_secret: process.env.GITHUB_CLIENT_SECRET!.trim(),
          code,
          redirect_uri: getCallbackUrl(),
        }),
      });

      const tokenJson = (await tokenResp.json()) as {
        access_token?: string;
        error?: string;
        error_description?: string;
      };

      if (!tokenResp.ok || !tokenJson.access_token) {
        res.status(400).send(
          renderPopupHtml(
            {
              type: 'GITHUB_OAUTH_ERROR',
              error: tokenJson.error_description || tokenJson.error || 'token_exchange_failed',
            },
            'GitHub 令牌交换失败，请检查 Client Secret 配置后重试。'
          )
        );
        return;
      }

      const sessionToken = crypto.randomBytes(32).toString('hex');
      sessions.set(sessionToken, {
        accessToken: tokenJson.access_token,
        createdAt: Date.now(),
      });

      res.send(
        renderPopupHtml(
          { type: 'GITHUB_OAUTH_SUCCESS', sessionToken },
          'GitHub 账号连接成功，正在返回工作台…'
        )
      );
    } catch {
      res.status(500).send(
        renderPopupHtml(
          { type: 'GITHUB_OAUTH_ERROR', error: 'network_error' },
          '连接 GitHub 服务器超时，请稍后重试。'
        )
      );
    }
  };

  app.get(['/auth/github/callback', '/auth/github/callback/'], handleOAuthCallback);

  // 4. Disconnect / revoke server session
  app.post('/api/github/logout', (req: Request, res: Response) => {
    const authHeader = req.header('authorization') || '';
    if (authHeader.startsWith('Bearer ')) {
      sessions.delete(authHeader.slice(7).trim());
    }
    res.json({ ok: true });
  });

  // 5. Fetch authenticated GitHub profile and user repositories
  app.get('/api/github/me', async (req: Request, res: Response) => {
    const session = getSessionFromRequest(req);
    if (!session) {
      res.status(401).json({ error: '请先连接 GitHub 账号。' });
      return;
    }

    try {
      const [userResp, reposResp] = await Promise.all([
        githubApiFetch('/user', session.accessToken),
        githubApiFetch('/user/repos?sort=updated&per_page=40&affiliation=owner,collaborator', session.accessToken),
      ]);

      if (userResp.status === 401) {
        res.status(401).json({ error: 'GitHub 授权已失效，请重新连接。' });
        return;
      }

      if (!userResp.ok || !reposResp.ok) {
        res.status(502).json({ error: '无法读取 GitHub 账号或仓库列表。' });
        return;
      }

      const userData = (await userResp.json()) as {
        login: string;
        name: string | null;
        avatar_url: string;
        html_url: string;
      };
      const reposData = (await reposResp.json()) as Array<{
        id: number;
        name: string;
        full_name: string;
        owner: { login: string };
        private: boolean;
        default_branch: string;
        html_url: string;
        updated_at: string;
      }>;

      res.json({
        user: {
          login: userData.login,
          name: userData.name,
          avatarUrl: userData.avatar_url,
          htmlUrl: userData.html_url,
        },
        repos: reposData.map((r) => ({
          id: r.id,
          name: r.name,
          fullName: r.full_name,
          owner: r.owner.login,
          private: r.private,
          defaultBranch: r.default_branch || 'main',
          htmlUrl: r.html_url,
          updatedAt: r.updated_at,
        })),
      });
    } catch {
      res.status(500).json({ error: '查询 GitHub 信息时发生网络错误。' });
    }
  });

  // 6. Create a new repository on the user's GitHub account
  app.post('/api/github/repos', async (req: Request, res: Response) => {
    const session = getSessionFromRequest(req);
    if (!session) {
      res.status(401).json({ error: '请先连接 GitHub 账号。' });
      return;
    }

    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const isPrivate = req.body?.private !== false;
    const description =
      typeof req.body?.description === 'string'
        ? req.body.description.trim().slice(0, 200)
        : 'OpenTune — Open-source macOS (.dmg) & Android (.apk) native client for YouTube Music';

    const nameErr = validateNewRepoName(name);
    if (nameErr) {
      res.status(400).json({ error: nameErr });
      return;
    }

    try {
      const createResp = await githubApiFetch('/user/repos', session.accessToken, {
        method: 'POST',
        body: {
          name,
          description,
          private: isPrivate,
          auto_init: true,
        },
      });

      const payload = (await createResp.json()) as {
        id?: number;
        name?: string;
        full_name?: string;
        owner?: { login: string };
        private?: boolean;
        default_branch?: string;
        html_url?: string;
        updated_at?: string;
        message?: string;
      };

      if (!createResp.ok || !payload.id || !payload.owner) {
        res.status(createResp.status).json({
          error: payload.message || '创建 GitHub 仓库失败，请检查仓库名是否重复。',
        });
        return;
      }

      res.status(201).json({
        repo: {
          id: payload.id,
          name: payload.name,
          fullName: payload.full_name,
          owner: payload.owner.login,
          private: Boolean(payload.private),
          defaultBranch: payload.default_branch || 'main',
          htmlUrl: payload.html_url,
          updatedAt: payload.updated_at || new Date().toISOString(),
        },
      });
    } catch {
      res.status(500).json({ error: '创建仓库请求失败，请稍后重试。' });
    }
  });

  // 7. Atomically push all generated macOS (.dmg), Android (.apk) & Actions files to GitHub
  app.post('/api/github/deploy', async (req: Request, res: Response) => {
    const session = getSessionFromRequest(req);
    if (!session) {
      res.status(401).json({ error: '请先连接 GitHub 账号。' });
      return;
    }

    const owner = typeof req.body?.owner === 'string' ? req.body.owner.trim() : '';
    const repo = typeof req.body?.repo === 'string' ? req.body.repo.trim() : '';
    const branch = typeof req.body?.branch === 'string' ? req.body.branch.trim() : 'main';
    const includeStudioSource = req.body?.includeStudioSource !== false;
    const configureOpenSource = req.body?.configureOpenSource !== false;
    const makePublic = req.body?.makePublic !== false;
    const config = req.body?.config as ClientConfig | undefined;

    if (!isValidGitHubSegment(owner) || !isValidGitHubSegment(repo)) {
      res.status(400).json({ error: '目标仓库拥有者或仓库名格式无效。' });
      return;
    }
    if (!isValidGitHubBranch(branch)) {
      res.status(400).json({ error: '目标分支名称无效。' });
      return;
    }
    if (!config || typeof config !== 'object') {
      res.status(400).json({ error: '缺少客户端配置参数。' });
      return;
    }

    const cfgErrors = validateClientConfig(config);
    if (hasValidationErrors(cfgErrors)) {
      res.status(400).json({ error: '客户端配置存在校验错误，请先在配置页修正。' });
      return;
    }

    const clientFiles = generateClientProjectFiles({
      ...config,
      githubRepo: `${owner}/${repo}`,
    });
    const uploadFiles: WorkspaceBlobFile[] = clientFiles.map((f) => ({
      repoPath: f.path,
      content: f.content,
      encoding: 'utf-8',
      executable: f.executable,
    }));

    let studioFilesCount = 0;
    if (includeStudioSource) {
      const studioFiles = collectStudioWorkspaceFiles(process.cwd(), 'studio-web');
      studioFilesCount = studioFiles.length;
      uploadFiles.push(...studioFiles);
    }

    try {
      // Step A: Resolve target branch head ref (auto-bootstrap empty repo if needed)
      let refResp = await githubApiFetch(
        `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`,
        session.accessToken
      );

      if (refResp.status === 409 || refResp.status === 404) {
        // Empty repo: bootstrap README.md via Contents API so git/ref exists
        const readmeFile = clientFiles.find((f) => f.path === 'README.md') ?? clientFiles[0];
        const initResp = await githubApiFetch(
          `/repos/${owner}/${repo}/contents/${readmeFile.path}`,
          session.accessToken,
          {
            method: 'PUT',
            body: {
              message: `chore: initialize ${config.appName} repository`,
              content: Buffer.from(readmeFile.content, 'utf-8').toString('base64'),
              branch,
            },
          }
        );
        if (!initResp.ok) {
          const errBody = (await initResp.json().catch(() => ({}))) as { message?: string };
          res.status(initResp.status).json({
            error: errBody.message || '初始化空仓库失败，请确认账号对该仓库具有写入权限。',
          });
          return;
        }
        refResp = await githubApiFetch(
          `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`,
          session.accessToken
        );
      }

      if (!refResp.ok) {
        const errBody = (await refResp.json().catch(() => ({}))) as { message?: string };
        res.status(refResp.status).json({
          error: errBody.message || `无法读取分支 ${branch}，请确认仓库分支存在。`,
        });
        return;
      }

      const refData = (await refResp.json()) as { object: { sha: string } };
      const latestCommitSha = refData.object.sha;

      // Step B: Get base tree SHA from latest commit
      const commitResp = await githubApiFetch(
        `/repos/${owner}/${repo}/git/commits/${latestCommitSha}`,
        session.accessToken
      );
      if (!commitResp.ok) {
        res.status(502).json({ error: '无法读取仓库最新提交树。' });
        return;
      }
      const commitData = (await commitResp.json()) as { tree: { sha: string } };
      const baseTreeSha = commitData.tree.sha;

      // Step C: Upload all project files as Git blobs in controlled batches of 5
      const treeEntries: Array<{
        path: string;
        mode: '100644' | '100755';
        type: 'blob';
        sha: string;
      }> = [];

      const BATCH_SIZE = 5;
      for (let i = 0; i < uploadFiles.length; i += BATCH_SIZE) {
        const batch = uploadFiles.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(
          batch.map(async (file) => {
            const blobResp = await githubApiFetch(`/repos/${owner}/${repo}/git/blobs`, session.accessToken, {
              method: 'POST',
              body: {
                content: file.content,
                encoding: file.encoding,
              },
            });
            if (!blobResp.ok) {
              const errBody = (await blobResp.json().catch(() => ({}))) as { message?: string };
              throw new Error(`上传文件 ${file.repoPath} 失败：${errBody.message || 'GitHub API 错误'}`);
            }
            const blobData = (await blobResp.json()) as { sha: string };
            return {
              path: file.repoPath,
              mode: (file.executable ? '100755' : '100644') as '100644' | '100755',
              type: 'blob' as const,
              sha: blobData.sha,
            };
          })
        );
        treeEntries.push(...batchResults);
      }

      // Step D: Create new Git tree
      const treeResp = await githubApiFetch(`/repos/${owner}/${repo}/git/trees`, session.accessToken, {
        method: 'POST',
        body: {
          base_tree: baseTreeSha,
          tree: treeEntries,
        },
      });
      if (!treeResp.ok) {
        const errBody = (await treeResp.json().catch(() => ({}))) as { message?: string };
        res.status(treeResp.status).json({
          error: errBody.message || '创建 Git 文件树失败（请确认授权包含 workflow 权限）。',
        });
        return;
      }
      const treeData = (await treeResp.json()) as { sha: string };

      // Step E: Create commit
      const commitSummary = includeStudioSource
        ? `build: sync ${config.appName} v${config.version} (macOS .dmg + Android .apk + studio-web)`
        : `build: sync ${config.appName} v${config.version} (macOS .dmg + Android .apk)`;

      const newCommitResp = await githubApiFetch(
        `/repos/${owner}/${repo}/git/commits`,
        session.accessToken,
        {
          method: 'POST',
          body: {
            message: commitSummary,
            tree: treeData.sha,
            parents: [latestCommitSha],
          },
        }
      );
      if (!newCommitResp.ok) {
        res.status(502).json({ error: '创建 Git 提交失败。' });
        return;
      }
      const newCommitData = (await newCommitResp.json()) as { sha: string };

      // Step F: Update branch ref (triggers push workflow automatically on main/master)
      const updateRefResp = await githubApiFetch(
        `/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`,
        session.accessToken,
        {
          method: 'PATCH',
          body: {
            sha: newCommitData.sha,
            force: false,
          },
        }
      );
      if (!updateRefResp.ok) {
        const errBody = (await updateRefResp.json().catch(() => ({}))) as { message?: string };
        res.status(updateRefResp.status).json({
          error: errBody.message || '更新目标分支指针失败。',
        });
        return;
      }

      // Persist bound open-source repo so the public download homepage auto-serves its latest .dmg / .apk Releases
      try {
        fs.writeFileSync(
          path.resolve(process.cwd(), '.opentune-release.json'),
          JSON.stringify({ repo: `${owner}/${repo}`, updatedAt: new Date().toISOString() }, null, 2),
          'utf-8'
        );
      } catch {
        // Non-fatal if filesystem is read-only
      }

      // Step G: Optionally configure repository for open-source launch & auto-enable GitHub Pages (/docs)
      const expectedPagesUrl = `https://${owner}.github.io/${repo}/`;
      let pagesUrl = expectedPagesUrl;
      let pagesEnabled = false;
      let pagesNote = '';
      let repoMetadataUpdated = false;

      if (configureOpenSource) {
        const repoPatchBody: Record<string, unknown> = {
          description: `${config.appName} — Open-source YouTube Music client for macOS (.dmg) & Android (.apk)`,
          homepage: expectedPagesUrl,
          has_issues: true,
        };
        if (makePublic) {
          repoPatchBody.private = false;
        }

        const patchResp = await githubApiFetch(`/repos/${owner}/${repo}`, session.accessToken, {
          method: 'PATCH',
          body: repoPatchBody,
        }).catch(() => null);
        repoMetadataUpdated = Boolean(patchResp && patchResp.ok);

        await githubApiFetch(`/repos/${owner}/${repo}/topics`, session.accessToken, {
          method: 'PUT',
          body: {
            names: ['youtube-music', 'macos', 'android', 'electron', 'open-source', 'music-player'],
          },
        }).catch(() => null);

        // Enable or update GitHub Pages pointing to <branch> /docs
        const createPagesResp = await githubApiFetch(`/repos/${owner}/${repo}/pages`, session.accessToken, {
          method: 'POST',
          body: {
            source: {
              branch,
              path: '/docs',
            },
          },
        }).catch(() => null);

        if (createPagesResp && (createPagesResp.status === 201 || createPagesResp.ok)) {
          const pagesData = (await createPagesResp.json().catch(() => ({}))) as { html_url?: string };
          pagesEnabled = true;
          if (pagesData.html_url) pagesUrl = pagesData.html_url;
        } else if (createPagesResp && createPagesResp.status === 409) {
          // Pages already exists: update its source to <branch> /docs
          const updatePagesResp = await githubApiFetch(`/repos/${owner}/${repo}/pages`, session.accessToken, {
            method: 'PUT',
            body: {
              source: {
                branch,
                path: '/docs',
              },
            },
          }).catch(() => null);
          pagesEnabled = Boolean(updatePagesResp && (updatePagesResp.ok || updatePagesResp.status === 204));
          if (!pagesEnabled) {
            pagesNote = 'GitHub Pages 已开启，请在仓库 Settings → Pages 确认源目录为 /docs。';
          }
        } else {
          const errJson = createPagesResp
            ? ((await createPagesResp.json().catch(() => ({}))) as { message?: string })
            : {};
          pagesNote = errJson.message
            ? `GitHub Pages 暂未自动开启（${errJson.message}），请确认仓库为 Public 后在 Settings → Pages 选择 ${branch} /docs。`
            : `请在仓库 Settings → Pages 选择 ${branch} /docs 手动开启一次。`;
        }
      }

      // Also attempt explicit workflow_dispatch if branch is neither main nor master
      if (branch !== 'main' && branch !== 'master') {
        await githubApiFetch(
          `/repos/${owner}/${repo}/actions/workflows/build-clients.yml/dispatches`,
          session.accessToken,
          {
            method: 'POST',
            body: { ref: branch },
          }
        ).catch(() => {});
      }

      res.json({
        commitSha: newCommitData.sha,
        commitUrl: `https://github.com/${owner}/${repo}/commit/${newCommitData.sha}`,
        actionsUrl: `https://github.com/${owner}/${repo}/actions/workflows/build-clients.yml`,
        releasesUrl: `https://github.com/${owner}/${repo}/releases`,
        pagesUrl,
        pagesEnabled,
        pagesNote,
        repoMetadataUpdated,
        fileCount: uploadFiles.length,
        studioFilesCount,
      });
    } catch (err) {
      const msg = err instanceof Error && err.message.startsWith('上传文件')
        ? err.message
        : '推送代码至 GitHub 时发生网络异常，请重试。';
      res.status(500).json({ error: msg });
    }
  });

  // 8. Manually trigger workflow_dispatch for .dmg & .apk build
  app.post('/api/github/dispatch', async (req: Request, res: Response) => {
    const session = getSessionFromRequest(req);
    if (!session) {
      res.status(401).json({ error: '请先连接 GitHub 账号。' });
      return;
    }

    const owner = typeof req.body?.owner === 'string' ? req.body.owner.trim() : '';
    const repo = typeof req.body?.repo === 'string' ? req.body.repo.trim() : '';
    const branch = typeof req.body?.branch === 'string' ? req.body.branch.trim() : 'main';

    if (!isValidGitHubSegment(owner) || !isValidGitHubSegment(repo) || !isValidGitHubBranch(branch)) {
      res.status(400).json({ error: '仓库或分支参数无效。' });
      return;
    }

    try {
      const dispatchResp = await githubApiFetch(
        `/repos/${owner}/${repo}/actions/workflows/build-clients.yml/dispatches`,
        session.accessToken,
        {
          method: 'POST',
          body: { ref: branch },
        }
      );

      if (!dispatchResp.ok) {
        const errBody = (await dispatchResp.json().catch(() => ({}))) as { message?: string };
        res.status(dispatchResp.status).json({
          error: errBody.message || '触发构建失败，请先推送源码到该仓库。',
        });
        return;
      }

      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: '触发 GitHub Actions 工作流时出错。' });
    }
  });

  // 9. Poll GitHub Actions runs and artifacts for .dmg / .apk downloads
  app.get('/api/github/runs', async (req: Request, res: Response) => {
    const session = getSessionFromRequest(req);
    if (!session) {
      res.status(401).json({ error: '请先连接 GitHub 账号。' });
      return;
    }

    const owner = typeof req.query.owner === 'string' ? req.query.owner.trim() : '';
    const repo = typeof req.query.repo === 'string' ? req.query.repo.trim() : '';

    if (!isValidGitHubSegment(owner) || !isValidGitHubSegment(repo)) {
      res.status(400).json({ error: '仓库参数无效。' });
      return;
    }

    try {
      const runsResp = await githubApiFetch(
        `/repos/${owner}/${repo}/actions/workflows/build-clients.yml/runs?per_page=8`,
        session.accessToken
      );

      if (runsResp.status === 404) {
        res.json({ runs: [], workflowMissing: true });
        return;
      }

      if (!runsResp.ok) {
        res.status(runsResp.status).json({ error: '无法查询 GitHub Actions 构建记录。' });
        return;
      }

      const runsPayload = (await runsResp.json()) as {
        workflow_runs?: Array<{
          id: number;
          run_number: number;
          status: string;
          conclusion: string | null;
          html_url: string;
          head_branch: string;
          head_sha: string;
          created_at: string;
          updated_at: string;
        }>;
      };

      const rawRuns = runsPayload.workflow_runs ?? [];
      const enrichedRuns = await Promise.all(
        rawRuns.map(async (run) => {
          let artifacts: Array<{
            id: number;
            name: string;
            sizeInBytes: number;
            expired: boolean;
            createdAt: string;
          }> = [];

          if (run.status === 'completed') {
            const artResp = await githubApiFetch(
              `/repos/${owner}/${repo}/actions/runs/${run.id}/artifacts`,
              session.accessToken
            ).catch(() => null);

            if (artResp && artResp.ok) {
              const artData = (await artResp.json()) as {
                artifacts?: Array<{
                  id: number;
                  name: string;
                  size_in_bytes: number;
                  expired: boolean;
                  created_at: string;
                }>;
              };
              artifacts = (artData.artifacts ?? []).map((a) => ({
                id: a.id,
                name: a.name,
                sizeInBytes: a.size_in_bytes,
                expired: a.expired,
                createdAt: a.created_at,
              }));
            }
          }

          return {
            id: run.id,
            runNumber: run.run_number,
            status: run.status,
            conclusion: run.conclusion,
            htmlUrl: run.html_url,
            headBranch: run.head_branch,
            headSha: run.head_sha.slice(0, 7),
            createdAt: run.created_at,
            updatedAt: run.updated_at,
            artifacts,
          };
        })
      );

      res.json({ runs: enrichedRuns, workflowMissing: false });
    } catch {
      res.status(500).json({ error: '查询构建状态时发生网络异常。' });
    }
  });

  // 10. Authenticated proxy to download a built .dmg / .apk artifact ZIP from GitHub Actions
  app.get('/api/github/artifacts/:owner/:repo/:artifactId/download', async (req: Request, res: Response) => {
    const session = getSessionFromRequest(req);
    if (!session) {
      res.status(401).json({ error: '请先连接 GitHub 账号。' });
      return;
    }

    const { owner, repo, artifactId } = req.params;
    if (!isValidGitHubSegment(owner) || !isValidGitHubSegment(repo) || !/^\d+$/.test(artifactId)) {
      res.status(400).json({ error: '无效的产物下载参数。' });
      return;
    }

    try {
      const dlResp = await githubApiFetch(
        `/repos/${owner}/${repo}/actions/artifacts/${artifactId}/zip`,
        session.accessToken
      );

      if (!dlResp.ok) {
        res.status(dlResp.status).json({ error: '无法下载该构建产物（可能已过期或无权限）。' });
        return;
      }

      const arrayBuf = await dlResp.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="ytm-artifact-${artifactId}.zip"`);
      res.send(buffer);
    } catch {
      res.status(500).json({ error: '下载构建产物时发生错误。' });
    }
  });

  // 11. Public release endpoints: remember bound owner/repo and fetch latest .dmg / .apk direct links
  const releaseStorePath = path.resolve(process.cwd(), '.opentune-release.json');

  const readBoundReleaseRepo = (): string => {
    const envRepo = (process.env.GITHUB_REPO || '').trim();
    if (envRepo && envRepo.includes('/')) return envRepo;
    try {
      if (fs.existsSync(releaseStorePath)) {
        const parsed = JSON.parse(fs.readFileSync(releaseStorePath, 'utf-8')) as { repo?: string };
        if (typeof parsed.repo === 'string' && parsed.repo.includes('/')) {
          return parsed.repo.trim();
        }
      }
    } catch {
      // Ignore malformed cache
    }
    return '';
  };

  app.post('/api/releases/bind', (req: Request, res: Response) => {
    const raw = typeof req.body?.repo === 'string' ? req.body.repo.trim() : '';
    if (!raw) {
      try {
        if (fs.existsSync(releaseStorePath)) fs.unlinkSync(releaseStorePath);
      } catch {
        // Ignore
      }
      res.json({ repo: '' });
      return;
    }
    const parts = raw.replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').split('/').filter(Boolean);
    const owner = parts[0] || '';
    const repo = parts[1] || '';
    if (!isValidGitHubSegment(owner) || !isValidGitHubSegment(repo)) {
      res.status(400).json({ error: '无效的 GitHub 仓库格式，应为 owner/repo。' });
      return;
    }
    const full = `${owner}/${repo}`;
    try {
      fs.writeFileSync(
        releaseStorePath,
        JSON.stringify({ repo: full, updatedAt: new Date().toISOString() }, null, 2),
        'utf-8'
      );
    } catch {
      // Non-fatal
    }
    res.json({ repo: full });
  });

  app.get('/api/releases/latest', async (req: Request, res: Response) => {
    const queryRepo = typeof req.query.repo === 'string' ? req.query.repo.trim() : '';
    const targetRepo = queryRepo || readBoundReleaseRepo();
    if (!targetRepo) {
      res.json({ repo: '', found: false });
      return;
    }

    const parts = targetRepo.replace(/^https?:\/\/github\.com\//i, '').split('/').filter(Boolean);
    const owner = parts[0] || '';
    const repo = parts[1] || '';
    if (!isValidGitHubSegment(owner) || !isValidGitHubSegment(repo)) {
      res.status(400).json({ error: '仓库路径格式无效。' });
      return;
    }

    const full = `${owner}/${repo}`;
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'OpenTune-Release-Fetcher',
      'X-GitHub-Api-Version': '2022-11-28',
    };

    try {
      type GitHubReleaseAsset = { name: string; size: number; browser_download_url: string };
      type GitHubReleasePayload = {
        tag_name?: string;
        published_at?: string;
        html_url?: string;
        assets?: GitHubReleaseAsset[];
      };

      const resp = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, { headers });
      let releaseData: GitHubReleasePayload | null = null;

      if (resp.ok) {
        releaseData = (await resp.json()) as GitHubReleasePayload;
      } else if (resp.status === 404) {
        // Fallback: check list of releases (e.g. prerelease or newly created tag)
        const listResp = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases?per_page=1`, { headers });
        if (listResp.ok) {
          const list = (await listResp.json()) as GitHubReleasePayload[];
          if (Array.isArray(list) && list.length > 0) {
            releaseData = list[0];
          }
        }
      }

      if (!releaseData) {
        res.json({
          repo: full,
          found: false,
          htmlUrl: `https://github.com/${full}/releases`,
          message: '仓库暂未公开最新 Release（如为私有仓库请先在 GitHub 设为 Public，或在构建工坊运行一次云端打包）。',
        });
        return;
      }

      const assets: GitHubReleaseAsset[] = Array.isArray(releaseData.assets) ? releaseData.assets : [];
      const dmg = assets.find((a) => /\.dmg$/i.test(a.name));
      const apk = assets.find((a) => /\.apk$/i.test(a.name));

      res.json({
        repo: full,
        found: true,
        tagName: releaseData.tag_name || '',
        publishedAt: releaseData.published_at || '',
        htmlUrl: releaseData.html_url || `https://github.com/${full}/releases`,
        dmgAsset: dmg ? { name: dmg.name, size: dmg.size, downloadUrl: dmg.browser_download_url } : null,
        apkAsset: apk ? { name: apk.name, size: apk.size, downloadUrl: apk.browser_download_url } : null,
      });
    } catch {
      res.status(502).json({
        repo: full,
        found: false,
        htmlUrl: `https://github.com/${full}/releases`,
        message: '读取 GitHub Releases 网络超时，请稍后重试。',
      });
    }
  });

  // Mount Vite middleware in development or static dist in production
  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found.');
      }
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`YTM Native Studio server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
