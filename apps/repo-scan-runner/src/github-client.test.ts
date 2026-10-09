import { describe, expect, it, vi } from 'vitest';
import { GitHubClient, GitHubError } from './github-client.js';

function response(status: number, body: unknown, headers: Record<string, string> = {}) { return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } }); }

describe('GitHubClient failure classification', () => {
  it.each([[401, false], [403, false], [404, false], [500, true], [503, true]] as const)('classifies HTTP %s', async (status, retryable) => {
    const client = new GitHubClient(null, vi.fn().mockResolvedValue(response(status, { message: 'failed' })));
    const error = await client.repository('owner', 'repo').catch((caught: unknown) => caught) as GitHubError;
    expect(error).toBeInstanceOf(GitHubError); expect(error.retryable).toBe(retryable); expect(error.status).toBe(status);
  });
  it('captures rate-limit reset without exposing credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(403, { message: 'rate limited' }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1893456000' }));
    const client = new GitHubClient('super-secret-token', fetchMock);
    const error = await client.repository('owner', 'repo').catch((caught: unknown) => caught) as GitHubError;
    expect(error.rateLimited).toBe(true); expect(error.retryable).toBe(true); expect(error.resetAt).toBeInstanceOf(Date);
    expect(error.message).not.toContain('super-secret-token');
  });
  it('rejects unsupported blob encodings without retrying', async () => {
    const client = new GitHubClient(null, vi.fn().mockResolvedValue(response(200, { encoding: 'utf-8', content: 'unsafe archive-like payload', size: 27 })));
    await expect(client.blob('owner', 'repo', 'a'.repeat(40))).rejects.toMatchObject({ retryable: false, status: 422 });
  });
  it('rejects oversized GitHub responses', async () => {
    vi.stubEnv('GITHUB_MAX_RESPONSE_BYTES', '10');
    const client = new GitHubClient(null, vi.fn().mockResolvedValue(response(200, { id: 1, default_branch: 'main' })));
    await expect(client.repository('owner', 'repo')).rejects.toMatchObject({ retryable: false });
    vi.unstubAllEnvs();
  });
  it('classifies network timeouts as retryable', async () => {
    const client = new GitHubClient(null, vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError')));
    await expect(client.repository('owner', 'repo')).rejects.toMatchObject({ retryable: true, status: null });
  });
});
