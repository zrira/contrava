import type { ConsumeMessage } from 'amqplib';
import { describe, expect, it, vi } from 'vitest';
import type { RepositoryScanDisposition, RepositoryScanMessage } from '@contrava/shared';
import { RepositoryScanConsumer } from './rabbit-consumer.js';
import { GitHubError } from './github-client.js';

const payload: RepositoryScanMessage = { version: 1, messageId: '11111111-1111-4111-8111-111111111111', repositoryScanId: '22222222-2222-4222-8222-222222222222', repositoryId: '33333333-3333-4333-8333-333333333333', commitSha: null, correlationId: 'request', createdAt: new Date().toISOString() };
const claim = { scanId: payload.repositoryScanId, repositoryId: payload.repositoryId, owner: 'owner', name: 'repo', branch: 'main', commitSha: null, previousCommitSha: null, attempt: 1, maxAttempts: 4, claimToken: 'token', runnerId: 'runner', leaseExpiresAt: new Date(Date.now() + 60_000).toISOString() };
const message = () => ({ content: Buffer.from(JSON.stringify(payload)), fields: { redelivered: false }, properties: {} }) as ConsumeMessage;
const channel = () => ({ ack: vi.fn(), nack: vi.fn(), reject: vi.fn() });
function api(disposition: RepositoryScanDisposition) { return { claim: vi.fn().mockResolvedValue(disposition), resolve: vi.fn(), heartbeat: vi.fn(), complete: vi.fn(), fail: vi.fn().mockResolvedValue({ status: 'RETRY_SCHEDULED' }) }; }
const options = { runnerId: 'runner', rabbitUrl: 'amqp://unused', prefetch: 1, heartbeatMs: 60_000 };

describe('repository scan acknowledgement policy', () => {
  it('acks completed duplicate deliveries without GitHub work', async () => {
    const broker = channel(); const github = { repository: vi.fn() };
    await new RepositoryScanConsumer(api({ disposition: 'COMPLETED' }) as never, github as never, {} as never, options).handle(broker as never, message());
    expect(broker.ack).toHaveBeenCalledOnce(); expect(github.repository).not.toHaveBeenCalled();
  });
  it('persists a retry before acknowledging transient GitHub failures', async () => {
    const broker = channel(); const client = api({ disposition: 'CLAIMED', scan: claim });
    const github = { repository: vi.fn().mockRejectedValue(new GitHubError('GitHub 503', 503, true)) };
    await new RepositoryScanConsumer(client as never, github as never, {} as never, options).handle(broker as never, message());
    expect(client.fail).toHaveBeenCalledWith(claim.scanId, expect.objectContaining({ retryable: true }), payload.correlationId);
    expect(client.fail.mock.invocationCallOrder[0]).toBeLessThan(broker.ack.mock.invocationCallOrder[0]!);
  });
  it('rejects terminal scans to the repository DLQ', async () => {
    const broker = channel(); await new RepositoryScanConsumer(api({ disposition: 'TERMINAL' }) as never, {} as never, {} as never, options).handle(broker as never, message());
    expect(broker.reject).toHaveBeenCalledWith(expect.anything(), false);
  });
});
