import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { JobRepository } from './job.repository';
import { JobsService } from './jobs.service';
import { SchedulerService } from '../scheduler/scheduler.service';
import { OutboxRepository } from '../outbox/outbox.repository';

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

  it('does not let a redelivered old message bypass a durable retry delay', async () => {
    const api = await createApi();
    const scheduledFor = new Date(Date.now() + 5_000);
    const job = await prisma.scanJob.create({ data: { apiId: api.id, status: 'RETRY_SCHEDULED', scheduledFor, attempt: 1 } });
    await expect(repository.claimById(job.id, 'early-runner', 30_000)).resolves.toMatchObject({ disposition: 'BUSY', retryAfterMs: expect.any(Number) });
    await prisma.scanJob.update({ where: { id: job.id }, data: { scheduledFor: new Date(Date.now() - 1) } });
    await expect(repository.claimById(job.id, 'due-runner', 30_000)).resolves.toMatchObject({ disposition: 'CLAIMED', job: { attempt: 2, runnerId: 'due-runner' } });
  });

  it('serializes concurrent completions for the same API snapshot', async () => {
    const api = await createApi();
    await prisma.scanJob.createMany({ data: [{ apiId: api.id }, { apiId: api.id }] });
    const jobs = await repository.claimBatch('completion-runner', 2, 30_000);
    const service = new JobsService(prisma as never, repository);
    await Promise.all(jobs.map((job) => service.start(job.id, job.claimToken, job.runnerId)));
    const result = { hash: 'b'.repeat(64), spec: { openapi: '3.1.0' }, previousSnapshotId: null, changes: [] };
    await Promise.all(jobs.map((job) => service.complete(job.id, { ...result, claimToken: job.claimToken, runnerId: job.runnerId })));
    expect(await prisma.apiSnapshot.count({ where: { apiId: api.id } })).toBe(1);
    expect(await prisma.scanJob.count({ where: { apiId: api.id, status: 'COMPLETED' } })).toBe(2);
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

describe('PostgreSQL outbox locking', () => {
  it('claims each message once across concurrent publishers', async () => {
    const api = await createApi('Outbox API');
    const jobs = new JobsService(prisma as never, repository);
    await Promise.all(Array.from({ length: 20 }, () => jobs.enqueue(api.id)));
    const publishers = Array.from({ length: 10 }, () => new OutboxRepository(prisma as never));
    const batches = await Promise.all(publishers.map((publisher) => publisher.claimBatch(2)));
    const rows = batches.flat();
    expect(rows).toHaveLength(20);
    expect(new Set(rows.map((row) => row.id)).size).toBe(20);
  });

  it('recovers an abandoned publisher lock after its timeout', async () => {
    const api = await createApi('Stale outbox API');
    const jobs = new JobsService(prisma as never, repository);
    const job = await jobs.enqueue(api.id);
    const outbox = new OutboxRepository(prisma as never);
    const [first] = await outbox.claimBatch(1);
    expect(first?.jobId).toBe(job.id);
    await expect(outbox.claimBatch(1)).resolves.toHaveLength(0);
    await prisma.outboxMessage.update({ where: { id: first!.id }, data: { lockedAt: new Date(Date.now() - 31_000) } });
    const [recovered] = await outbox.claimBatch(1);
    expect(recovered?.id).toBe(first!.id);
    expect(recovered?.lockToken).not.toBe(first!.lockToken);
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
