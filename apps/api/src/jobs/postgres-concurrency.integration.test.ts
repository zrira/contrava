import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { JobRepository } from './job.repository';
import { JobsService } from './jobs.service';
import { SchedulerService } from '../scheduler/scheduler.service';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL is required for PostgreSQL integration tests');
const prisma = new PrismaClient({ datasources: { db: { url } } });
const repository = new JobRepository(prisma as never);

async function createApi(name = 'Concurrency API') {
  return prisma.trackedApi.create({ data: { name, specUrl: 'https://example.com/openapi.json' } });
}

beforeAll(() => prisma.$connect());
beforeEach(async () => { await prisma.trackedApi.deleteMany(); });
afterAll(() => prisma.$disconnect());

describe('PostgreSQL concurrent job claiming', () => {
  it('claims 20 jobs at most once across concurrent consumers', async () => {
    const api = await createApi();
    await prisma.scanJob.createMany({ data: Array.from({ length: 20 }, () => ({ apiId: api.id })) });
    const batches = await Promise.all(Array.from({ length: 10 }, (_, index) => repository.claimBatch(`runner-${index}`, 2, 30_000)));
    const jobs = batches.flat();
    expect(jobs).toHaveLength(20);
    expect(new Set(jobs.map((job) => job.id)).size).toBe(20);
    expect(new Set(jobs.map((job) => job.claimToken)).size).toBe(20);
  });

  it('gives a single job to exactly one simultaneous claimer', async () => {
    const api = await createApi();
    await prisma.scanJob.create({ data: { apiId: api.id } });
    const claims = await Promise.all(Array.from({ length: 12 }, (_, index) => repository.claimBatch(`runner-${index}`, 1, 30_000)));
    expect(claims.flat()).toHaveLength(1);
  });

  it('reclaims an expired lease exactly once and rejects the old owner', async () => {
    const api = await createApi();
    const original = await prisma.scanJob.create({ data: { apiId: api.id, status: 'RUNNING', attempt: 1, claimToken: '11111111-1111-4111-8111-111111111111', runnerId: 'runner-old', leaseExpiresAt: new Date(Date.now() - 1000) } });
    const claims = await Promise.all(Array.from({ length: 8 }, (_, index) => repository.claimBatch(`runner-new-${index}`, 1, 30_000)));
    const [reclaimed] = claims.flat();
    expect(reclaimed).toBeDefined();
    expect(claims.flat()).toHaveLength(1);
    expect(reclaimed!.attempt).toBe(2);
    const service = new JobsService(prisma as never, repository);
    await expect(service.heartbeat(original.id, original.claimToken!, 'runner-old')).rejects.toThrow('no longer owned');
    await service.start(reclaimed!.id, reclaimed!.claimToken, reclaimed!.runnerId);
    const result = { hash: 'a'.repeat(64), spec: { openapi: '3.1.0' }, previousSnapshotId: null, changes: [] };
    await expect(service.complete(original.id, { ...result, claimToken: original.claimToken!, runnerId: 'runner-old' })).rejects.toThrow('not held');
    await expect(service.complete(reclaimed!.id, { ...result, claimToken: reclaimed!.claimToken, runnerId: reclaimed!.runnerId })).resolves.toMatchObject({ status: 'COMPLETED' });
  });
});

describe('PostgreSQL scheduler locking', () => {
  it('creates one job for one slot across concurrent schedulers', async () => {
    const now = new Date();
    const api = await prisma.trackedApi.create({ data: { name: 'Due', specUrl: 'https://example.com/spec', scanEnabled: true, scanIntervalMinutes: 5, nextScanAt: now } });
    const schedulers = [new SchedulerService(prisma as never), new SchedulerService(prisma as never)];
    await Promise.all(schedulers.map((scheduler) => scheduler.tick(now)));
    expect(await prisma.scanJob.count({ where: { apiId: api.id } })).toBe(1);
  });

  it('schedules multiple due APIs once each under contention', async () => {
    const now = new Date();
    await prisma.trackedApi.createMany({ data: Array.from({ length: 5 }, (_, index) => ({ name: `API ${index}`, specUrl: 'https://example.com/spec', scanEnabled: true, scanIntervalMinutes: 5, nextScanAt: now })) });
    const schedulers = Array.from({ length: 4 }, () => new SchedulerService(prisma as never));
    await Promise.all(schedulers.map((scheduler) => scheduler.tick(now)));
    expect(await prisma.scanJob.count({ where: { source: 'SCHEDULED' } })).toBe(5);
  });
});
