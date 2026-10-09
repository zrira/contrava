import { describe, expect, it, vi } from 'vitest';
import { JobsService } from './jobs.service';

const jobRepository = () => ({ claimBatch: vi.fn(), lockApiForSnapshot: vi.fn().mockResolvedValue(undefined) });

const baseJob = {
  id: 'job-1', apiId: 'api-1', correlationId: 'correlation-1', status: 'RUNNING', source: 'MANUAL', scheduleKey: null,
  attempt: 1, maxAttempts: 3, scheduledFor: new Date(), claimedAt: new Date(), startedAt: new Date(),
  leaseExpiresAt: new Date(Date.now() + 30_000), claimToken: 'token', runnerId: 'runner-1', completedAt: null,
  failedAt: null, lastError: null, createdAt: new Date(), updatedAt: new Date(),
};

function transactionalDb(overrides: Record<string, unknown> = {}) {
  const db = {
    scanJob: {
      findUnique: vi.fn().mockResolvedValue(baseJob),
      update: vi.fn().mockImplementation(({ data }) => Promise.resolve({ ...baseJob, ...data })),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findFirst: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      ...((overrides.scanJob as object | undefined) ?? {}),
    },
    scan: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), upsert: vi.fn().mockResolvedValue({}) },
    trackedApi: { update: vi.fn().mockResolvedValue({}) },
    outboxMessage: { create: vi.fn().mockResolvedValue({}) },
    apiSnapshot: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    apiChange: { create: vi.fn() },
    $transaction: vi.fn(),
  };
  db.$transaction.mockImplementation((callback: (client: typeof db) => unknown) => callback(db));
  return db;
}

describe('JobsService lifecycle', () => {
  it('delegates capacity-aware claims to the PostgreSQL repository', async () => {
    const claimBatch = vi.fn().mockResolvedValue([{ id: 'job-1' }]);
    const service = new JobsService(transactionalDb() as never, { ...jobRepository(), claimBatch } as never);
    await expect(service.claim('runner-1', 4)).resolves.toEqual([{ id: 'job-1' }]);
    expect(claimBatch).toHaveBeenCalledWith('runner-1', 4, 30_000);
  });

  it('rejects a stale heartbeat that no longer owns the row', async () => {
    const db = transactionalDb();
    db.scanJob.updateMany.mockResolvedValue({ count: 0 });
    await expect(new JobsService(db as never, jobRepository() as never).heartbeat('job-1', 'old-token', 'old-runner')).rejects.toThrow('no longer owned');
    expect(db.scanJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ claimToken: 'old-token', runnerId: 'old-runner' }) }));
  });

  it('schedules deterministic retries and increments attempts on the next claim', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
    const db = transactionalDb();
    const result = await new JobsService(db as never, jobRepository() as never).fail('job-1', 'token', 'runner-1', 'worker unavailable');
    expect(result).toMatchObject({ status: 'RETRY_SCHEDULED', lastError: 'worker unavailable' });
    expect(db.scanJob.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ scheduledFor: new Date('2025-01-01T00:00:05Z') }) }));
    vi.useRealTimers();
  });

  it('marks a job failed at its maximum attempt', async () => {
    const db = transactionalDb({ scanJob: { findUnique: vi.fn().mockResolvedValue({ ...baseJob, attempt: 3, maxAttempts: 3 }), update: vi.fn().mockImplementation(({ data }) => Promise.resolve(data)) } });
    await expect(new JobsService(db as never, jobRepository() as never).fail('job-1', 'token', 'runner-1', 'still failing')).resolves.toMatchObject({ status: 'FAILED' });
    expect(db.trackedApi.update).toHaveBeenCalledOnce();
  });

  it('treats duplicate completion as safe', async () => {
    const completed = { ...baseJob, status: 'COMPLETED', completedAt: new Date() };
    const db = transactionalDb({ scanJob: { findUnique: vi.fn().mockResolvedValue(completed) } });
    await expect(new JobsService(db as never, jobRepository() as never).complete('job-1', { claimToken: 'token', runnerId: 'runner-1', hash: 'hash', spec: { openapi: '3.1.0' }, previousSnapshotId: null, changes: [] })).resolves.toEqual(completed);
    expect(db.apiSnapshot.create).not.toHaveBeenCalled();
  });

  it('rejects completion from a stale owner after reclaim', async () => {
    const db = transactionalDb({ scanJob: { findUnique: vi.fn().mockResolvedValue({ ...baseJob, claimToken: 'new-token', runnerId: 'runner-2' }) } });
    await expect(new JobsService(db as never, jobRepository() as never).complete('job-1', { claimToken: 'old-token', runnerId: 'runner-1', hash: 'hash', spec: { openapi: '3.1.0' }, previousSnapshotId: null, changes: [] })).rejects.toThrow('not held');
  });

  it('does not duplicate snapshots or changes when a retry hash already exists', async () => {
    const db = transactionalDb();
    db.apiSnapshot.findUnique.mockResolvedValue({ id: 'snapshot-existing' });
    await new JobsService(db as never, jobRepository() as never).complete('job-1', { claimToken: 'token', runnerId: 'runner-1', hash: 'same', spec: { openapi: '3.1.0' }, previousSnapshotId: null, changes: [] });
    expect(db.apiSnapshot.create).not.toHaveBeenCalled();
    expect(db.apiChange.create).not.toHaveBeenCalled();
  });
});
