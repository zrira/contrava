import { describe, expect, it, vi } from 'vitest';
import type { ClaimedJob } from '@contrava/shared';
import type { RunnerApi } from './client.js';
import { JobRunner } from './runner.js';

const job = (id: string): ClaimedJob => ({ id, apiId: 'api-1', specUrl: 'https://example.com/spec', attempt: 1, maxAttempts: 3, claimToken: `token-${id}`, runnerId: 'runner-1', leaseExpiresAt: new Date(Date.now() + 30_000).toISOString(), previousSnapshot: null });

function fakeApi(queue: ClaimedJob[]): RunnerApi & { start: ReturnType<typeof vi.fn>; complete: ReturnType<typeof vi.fn> } {
  return {
    claim: vi.fn().mockImplementation((_runnerId: string, maxJobs: number) => Promise.resolve(queue.splice(0, maxJobs))),
    claimDelivery: vi.fn().mockResolvedValue({ disposition: 'NOT_FOUND' }),
    markDeadLettered: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue(undefined),
    heartbeat: vi.fn().mockResolvedValue(undefined),
    complete: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn().mockResolvedValue({ status: 'RETRY_SCHEDULED', attempt: 1, maxAttempts: 4 }),
  };
}

const options = { runnerId: 'runner-1', maxConcurrentJobs: 2, pollIntervalMs: 60_000, heartbeatMs: 10_000 };

describe('JobRunner concurrency', () => {
  it('respects MAX_CONCURRENT_JOBS', async () => {
    const api = fakeApi([job('1'), job('2'), job('3')]);
    const resolvers: Array<() => void> = [];
    const execute = vi.fn().mockImplementation(() => new Promise((resolve) => resolvers.push(() => resolve({ hash: 'h', spec: { openapi: '3.1.0' }, previousSnapshotId: null, changes: [] }))));
    const runner = new JobRunner(api, execute, options);
    runner.start();
    await vi.waitFor(() => expect(runner.activeJobs).toBe(2));
    expect(execute).toHaveBeenCalledTimes(2);
    for (const resolve of resolvers) resolve();
    await vi.waitFor(() => expect(runner.activeJobs).toBe(0));
    await runner.stop(0);
  });

  it('allows only one of two runners to execute a single claimed job', async () => {
    const api = fakeApi([job('only')]);
    const execute = vi.fn().mockResolvedValue({ hash: 'h', spec: { openapi: '3.1.0' }, previousSnapshotId: null, changes: [] });
    const first = new JobRunner(api, execute, { ...options, runnerId: 'runner-1' });
    const second = new JobRunner(api, execute, { ...options, runnerId: 'runner-2' });
    first.start(); second.start();
    await vi.waitFor(() => expect(api.complete).toHaveBeenCalledOnce());
    expect(execute).toHaveBeenCalledOnce();
    await Promise.all([first.stop(0), second.stop(0)]);
  });
});
