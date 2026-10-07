import { describe, expect, it, vi } from 'vitest';
import { JobsService } from './jobs.service';

const baseJob = {
  id: 'job-1', apiId: 'api-1', status: 'RUNNING', source: 'MANUAL', scheduleKey: null,
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
    apiSnapshot: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    apiChange: { create: vi.fn() },
    $transaction: vi.fn(),
  };
  db.$transaction.mockImplementation((callback: (client: typeof db) => unknown) => callback(db));
  return db;
}

describe('JobsService lifecycle', () => {
  it('claims one available job and leaves it unavailable to a second runner', async () => {
    const available = { ...baseJob, status: 'PENDING', attempt: 0 };
    const claimed = { ...available, attempt: 1, api: { specUrl: 'https://example.com/spec', snapshots: [] } };
    const db = transactionalDb();
    db.scanJob.findFirst.mockResolvedValueOnce(available).mockResolvedValueOnce(null);
    db.scanJob.findUniqueOrThrow.mockResolvedValue(claimed);
    const service = new JobsService(db as never);
    await expect(service.claim('runner-1')).resolves.toMatchObject({ id: 'job-1', attempt: 1 });
    await expect(service.claim('runner-2')).resolves.toBeNull();
    expect(db.scanJob.updateMany).toHaveBeenCalledOnce();
  });

  it('includes expired leases in the claim query while active leases remain excluded', async () => {
    const db = transactionalDb();
    db.scanJob.findFirst.mockResolvedValue(null);
    await new JobsService(db as never).claim('runner-2');
    expect(db.scanJob.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { OR: expect.arrayContaining([expect.objectContaining({ status: { in: ['CLAIMED', 'RUNNING'] }, leaseExpiresAt: expect.any(Object) })]) } }));
  });

  it('schedules deterministic retries and increments attempts on the next claim', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
    const db = transactionalDb();
    const result = await new JobsService(db as never).fail('job-1', 'token', 'worker unavailable');
    expect(result).toMatchObject({ status: 'RETRY_SCHEDULED', lastError: 'worker unavailable' });
    expect(db.scanJob.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ scheduledFor: new Date('2025-01-01T00:00:05Z') }) }));
    vi.useRealTimers();
  });

  it('marks a job failed at its maximum attempt', async () => {
    const db = transactionalDb({ scanJob: { findUnique: vi.fn().mockResolvedValue({ ...baseJob, attempt: 3, maxAttempts: 3 }), update: vi.fn().mockImplementation(({ data }) => Promise.resolve(data)) } });
    await expect(new JobsService(db as never).fail('job-1', 'token', 'still failing')).resolves.toMatchObject({ status: 'FAILED' });
    expect(db.trackedApi.update).toHaveBeenCalledOnce();
  });

  it('treats duplicate completion as safe', async () => {
    const completed = { ...baseJob, status: 'COMPLETED', completedAt: new Date() };
    const db = transactionalDb({ scanJob: { findUnique: vi.fn().mockResolvedValue(completed) } });
    await expect(new JobsService(db as never).complete('job-1', { claimToken: 'old', hash: 'hash', spec: { openapi: '3.1.0' }, previousSnapshotId: null, changes: [] })).resolves.toEqual(completed);
    expect(db.apiSnapshot.create).not.toHaveBeenCalled();
  });

  it('does not duplicate snapshots or changes when a retry hash already exists', async () => {
    const db = transactionalDb();
    db.apiSnapshot.findUnique.mockResolvedValue({ id: 'snapshot-existing' });
    await new JobsService(db as never).complete('job-1', { claimToken: 'token', hash: 'same', spec: { openapi: '3.1.0' }, previousSnapshotId: null, changes: [] });
    expect(db.apiSnapshot.create).not.toHaveBeenCalled();
    expect(db.apiChange.create).not.toHaveBeenCalled();
  });
});
