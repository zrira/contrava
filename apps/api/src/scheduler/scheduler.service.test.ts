import { afterEach, describe, expect, it, vi } from 'vitest';
import { SchedulerService } from './scheduler.service';

function database(api: { id: string; scanEnabled: boolean; scanIntervalMinutes: number; nextScanAt: Date } | null, due = true) {
  const db = {
    trackedApi: {
      findMany: vi.fn().mockResolvedValue(due && api ? [{ id: api.id }] : []),
      update: vi.fn().mockResolvedValue({}),
    },
    scanJob: { create: vi.fn().mockResolvedValue({ id: 'job-1', apiId: api?.id ?? 'api-1', correlationId: 'correlation-1' }) },
    outboxMessage: { create: vi.fn().mockResolvedValue({}) },
    $queryRaw: vi.fn().mockResolvedValue(api ? [api] : []),
    $transaction: vi.fn(),
  };
  db.$transaction.mockImplementation((callback: (client: typeof db) => unknown) => callback(db));
  return db;
}

afterEach(() => vi.restoreAllMocks());

describe('SchedulerService', () => {
  it('creates one job for a locked due API and advances its schedule', async () => {
    const now = new Date('2025-01-01T12:00:00Z');
    const db = database({ id: 'api-1', scanEnabled: true, scanIntervalMinutes: 15, nextScanAt: now });
    await expect(new SchedulerService(db as never).tick(now)).resolves.toBe(1);
    expect(db.$queryRaw).toHaveBeenCalledOnce();
    expect(db.scanJob.create).toHaveBeenCalledWith({ data: expect.objectContaining({ source: 'SCHEDULED', scheduleKey: `api-1:${now.toISOString()}` }) });
    expect(db.trackedApi.update).toHaveBeenCalledWith(expect.objectContaining({ data: { nextScanAt: new Date('2025-01-01T12:15:00Z') } }));
  });

  it.each(['disabled', 'future'])('does not create jobs for %s APIs', async () => {
    const db = database(null, false);
    await expect(new SchedulerService(db as never).tick(new Date())).resolves.toBe(0);
    expect(db.scanJob.create).not.toHaveBeenCalled();
  });

  it('does not create a duplicate after another scheduler advances the locked row', async () => {
    const now = new Date('2025-01-01T12:00:00Z');
    const db = database({ id: 'api-1', scanEnabled: true, scanIntervalMinutes: 5, nextScanAt: now });
    db.$queryRaw.mockResolvedValue([]);
    await expect(new SchedulerService(db as never).tick(now)).resolves.toBe(0);
    expect(db.scanJob.create).not.toHaveBeenCalled();
  });
});
