import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RepositoryScanClaim } from '@contrava/shared';
import { GitHubClient, GitHubError } from './github-client.js';
import { RepositoryScanner, safeSourcePath, supportedSourcePath } from './repository-scanner.js';
import { log } from './logger.js';

const claim: RepositoryScanClaim = { scanId: 'scan', repositoryId: 'repo', owner: 'owner', name: 'name', branch: 'main', commitSha: 'b'.repeat(40), previousCommitSha: null, attempt: 1, maxAttempts: 4, claimToken: 'token', runnerId: 'runner', leaseExpiresAt: new Date().toISOString() };
function github(overrides: Record<string, unknown> = {}) {
  return {
    repository: vi.fn().mockResolvedValue({ id: 1, default_branch: 'main' }), resolveCommit: vi.fn().mockResolvedValue('b'.repeat(40)),
    tree: vi.fn().mockResolvedValue([]), compare: vi.fn().mockResolvedValue(null), blob: vi.fn(), ...overrides,
  } as unknown as GitHubClient;
}
afterEach(() => vi.unstubAllEnvs());

describe('repository scanner safety and incrementality', () => {
  it.each(['../secret.ts', '/etc/passwd', 'src\\evil.ts', 'src/../evil.ts'])('rejects unsafe path %s', (path) => expect(safeSourcePath(path)).toBe(false));
  it.each(['node_modules/a.ts', 'dist/a.js', 'app.min.js', 'package-lock.json', 'image.png'])('filters %s', (path) => expect(supportedSourcePath(path)).toBe(false));
  it('rejects traversal entries before downloading blobs', async () => {
    const client = github({ tree: vi.fn().mockResolvedValue([{ path: '../evil.ts', type: 'blob', sha: 'a'.repeat(40), mode: '100644', size: 1 }]) });
    await expect(new RepositoryScanner(client).scan(claim)).rejects.toBeInstanceOf(GitHubError);
    expect(client.blob).not.toHaveBeenCalled();
  });
  it('rejects repositories over hard limits', async () => {
    vi.stubEnv('REPO_MAX_FILE_BYTES', '4');
    const client = github({ tree: vi.fn().mockResolvedValue([{ path: 'src/a.ts', type: 'blob', sha: 'a'.repeat(40), mode: '100644', size: 10 }]) });
    await expect(new RepositoryScanner(client).scan(claim)).rejects.toMatchObject({ retryable: false });
  });
  it('does not persist or parse binary files', async () => {
    const client = github({ tree: vi.fn().mockResolvedValue([{ path: 'src/a.ts', type: 'blob', sha: 'a'.repeat(40), mode: '100644', size: 3 }]), blob: vi.fn().mockResolvedValue(Buffer.from([0, 1, 2])) });
    await expect(new RepositoryScanner(client).scan(claim)).resolves.toMatchObject({ files: [] });
  });
  it('fetches only changed/new files and reports deleted files incrementally', async () => {
    const blob = vi.fn().mockImplementation((_owner, _name, sha: string) => Promise.resolve(Buffer.from(sha.startsWith('a') ? "fetch('/new')" : "axios.get('/changed')")));
    const client = github({ compare: vi.fn().mockResolvedValue([
      { filename: 'src/new.ts', status: 'added', sha: 'a'.repeat(40) },
      { filename: 'src/changed.ts', status: 'modified', sha: 'b'.repeat(40) },
      { filename: 'src/deleted.ts', status: 'removed', sha: '0'.repeat(40) },
    ]), blob });
    const result = await new RepositoryScanner(client).scan({ ...claim, previousCommitSha: 'a'.repeat(40) });
    expect(result.fullScan).toBe(false); expect(result.files.map((file) => file.path)).toEqual(['src/changed.ts', 'src/new.ts']);
    expect(result.deletedPaths).toEqual(['src/deleted.ts']); expect(blob).toHaveBeenCalledTimes(2); expect(client.tree).not.toHaveBeenCalled();
  });
});

describe('credential log redaction', () => {
  it('redacts token-like fields', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    log('test', { githubToken: 'secret', authorization: 'Bearer secret', repository: 'owner/name' });
    expect(spy.mock.calls[0]?.[0]).toContain('[REDACTED]'); expect(spy.mock.calls[0]?.[0]).not.toContain('Bearer secret');
    spy.mockRestore();
  });
});
