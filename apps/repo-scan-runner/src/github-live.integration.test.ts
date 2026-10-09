import { describe, expect, it } from 'vitest';
import { GitHubClient } from './github-client.js';

const target = process.env.LIVE_GITHUB_REPOSITORY?.split('/');
const suite = process.env.LIVE_GITHUB_TESTS === '1' && target?.length === 2 ? describe : describe.skip;
suite('live GitHub integration', () => {
  it('resolves the default branch to a pinned commit', async () => {
    const client = new GitHubClient(); const repository = await client.repository(target![0]!, target![1]!);
    await expect(client.resolveCommit(target![0]!, target![1]!, repository.default_branch)).resolves.toMatch(/^[0-9a-f]{40}$/i);
  }, 30_000);
});
