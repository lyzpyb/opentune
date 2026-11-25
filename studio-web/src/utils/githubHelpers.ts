const GITHUB_SEGMENT_REGEX = /^[A-Za-z0-9._-]{1,100}$/;
const GITHUB_BRANCH_REGEX = /^[A-Za-z0-9._/-]{1,120}$/;

export function isValidGitHubSegment(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed === '.' || trimmed === '..') return false;
  return GITHUB_SEGMENT_REGEX.test(trimmed);
}

export function isValidGitHubBranch(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes('..') || trimmed.startsWith('/') || trimmed.endsWith('/')) {
    return false;
  }
  return GITHUB_BRANCH_REGEX.test(trimmed);
}

export function validateNewRepoName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) {
    return '仓库名称不能为空。';
  }
  if (trimmed.length > 64) {
    return '仓库名称请控制在 64 个字符以内。';
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(trimmed)) {
    return '仓库名称仅支持字母、数字、连字符（-）、下划线（_）与小数点，且须以字母或数字开头。';
  }
  return null;
}

export function buildGitHubAuthorizeUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const qs = new URLSearchParams({
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    scope: 'repo workflow',
    state: params.state,
  });
  return `https://github.com/login/oauth/authorize?${qs.toString()}`;
}

export function formatWorkflowStatusLabel(status: string, conclusion: string | null): {
  label: string;
  tone: 'neutral' | 'running' | 'success' | 'error';
} {
  if (status === 'queued' || status === 'waiting' || status === 'pending') {
    return { label: '排队等待构建机', tone: 'running' };
  }
  if (status === 'in_progress') {
    return { label: '云端编译中 (.dmg + .apk)', tone: 'running' };
  }
  if (status === 'completed') {
    if (conclusion === 'success') {
      return { label: '打包成功', tone: 'success' };
    }
    if (conclusion === 'cancelled') {
      return { label: '已取消', tone: 'neutral' };
    }
    return { label: `构建失败 (${conclusion ?? 'error'})`, tone: 'error' };
  }
  return { label: status || '未知状态', tone: 'neutral' };
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}
