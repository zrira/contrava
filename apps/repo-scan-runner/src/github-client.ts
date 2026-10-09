export class GitHubError extends Error {
  constructor(message: string, readonly status: number | null, readonly retryable: boolean, readonly rateLimited = false, readonly resetAt: Date | null = null) { super(message); }
}
export interface GitHubRepository { id: number; default_branch: string }
export interface GitHubTreeEntry { path: string; type: 'blob' | 'tree' | 'commit'; sha: string; size?: number; mode: string }
export interface GitHubChangedFile { filename: string; previous_filename?: string; status: 'added' | 'modified' | 'removed' | 'renamed' | string; sha: string }

export class GitHubClient {
  private readonly timeoutMs = Number(process.env.GITHUB_TIMEOUT_MS ?? 15_000);
  private readonly apiUrl = process.env.GITHUB_API_URL ?? 'https://api.github.com';
  readonly authMode: 'PAT' | 'ANONYMOUS';
  lastRateLimit: { remaining: number | null; resetAt: string | null } = { remaining: null, resetAt: null };
  constructor(private readonly token = process.env.GITHUB_TOKEN?.trim() || null, private readonly fetchImpl: typeof fetch = fetch) { this.authMode = token ? 'PAT' : 'ANONYMOUS'; }

  private async request<T>(path: string): Promise<T> {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.apiUrl}${path}`, { signal: controller.signal, headers: {
        accept: 'application/vnd.github+json', 'user-agent': 'contrava-repo-scanner/1', 'x-github-api-version': '2022-11-28',
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      } });
      const remainingHeader = response.headers.get('x-ratelimit-remaining');
      const resetHeader = response.headers.get('x-ratelimit-reset');
      const remaining = remainingHeader === null ? null : Number(remainingHeader);
      const resetAt = resetHeader ? new Date(Number(resetHeader) * 1000) : null;
      this.lastRateLimit = { remaining: Number.isFinite(remaining) ? remaining : null, resetAt: resetAt && !Number.isNaN(resetAt.getTime()) ? resetAt.toISOString() : null };
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { message?: string } | null;
        const message = body?.message ?? `GitHub returned HTTP ${response.status}`;
        const rateLimited = (response.status === 403 || response.status === 429) && remaining === 0;
        if (rateLimited) throw new GitHubError(`GitHub rate limit exhausted${resetAt ? ` until ${resetAt.toISOString()}` : ''}`, response.status, true, true, resetAt);
        if (response.status === 401 || response.status === 403) throw new GitHubError('GitHub credentials are missing or unauthorized', response.status, false);
        if (response.status === 404) throw new GitHubError('GitHub repository or object was not found', response.status, false);
        throw new GitHubError(message, response.status, response.status >= 500 || response.status === 408 || response.status === 429);
      }
      return await response.json() as T;
    } catch (error) {
      if (error instanceof GitHubError) throw error;
      throw new GitHubError(error instanceof Error ? `GitHub request failed: ${error.message}` : 'GitHub request failed', null, true);
    } finally { clearTimeout(timer); }
  }

  repository(owner: string, name: string) { return this.request<GitHubRepository>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`); }
  async resolveCommit(owner: string, name: string, branch: string): Promise<string> {
    const result = await this.request<{ sha: string }>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits/${encodeURIComponent(branch)}`);
    if (!/^[0-9a-f]{40}$/i.test(result.sha)) throw new GitHubError('GitHub returned an invalid commit SHA', 502, true);
    return result.sha;
  }
  async tree(owner: string, name: string, sha: string): Promise<GitHubTreeEntry[]> {
    const result = await this.request<{ truncated: boolean; tree: GitHubTreeEntry[] }>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/trees/${sha}?recursive=1`);
    if (result.truncated) throw new GitHubError('GitHub recursive tree was truncated; repository exceeds safe API limits', 422, false);
    return result.tree;
  }
  async compare(owner: string, name: string, base: string, head: string): Promise<GitHubChangedFile[] | null> {
    try {
      const result = await this.request<{ files?: GitHubChangedFile[]; total_commits: number }>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/compare/${base}...${head}`);
      if (!result.files || result.files.length >= 300 || result.total_commits >= 250) return null;
      return result.files;
    } catch (error) {
      if (error instanceof GitHubError && (error.status === 404 || error.status === 422)) return null;
      throw error;
    }
  }
  async blob(owner: string, name: string, sha: string): Promise<Buffer> {
    const result = await this.request<{ encoding: string; content: string; size: number }>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/blobs/${sha}`);
    if (result.encoding !== 'base64') throw new GitHubError('GitHub blob encoding is unsupported', 422, false);
    return Buffer.from(result.content.replace(/\s/g, ''), 'base64');
  }
}
