import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { CompleteJobRequest, ContractChange, OpenApiDocument } from '@contrava/shared';
import { PrismaService } from '../prisma/prisma.service';

const RETRY_DELAYS_MS = [5_000, 15_000] as const;

@Injectable()
export class JobsService {
  private readonly leaseMs = Number(process.env.JOB_LEASE_MS ?? 30_000);
  private readonly defaultMaxAttempts = Number(process.env.MAX_JOB_ATTEMPTS ?? 3);

  constructor(private readonly prisma: PrismaService) {}

  enqueue(apiId: string, source: 'MANUAL' | 'SCHEDULED' = 'MANUAL', scheduleKey?: string) {
    return this.prisma.scanJob.create({
      data: {
        apiId,
        source,
        maxAttempts: this.defaultMaxAttempts,
        ...(scheduleKey ? { scheduleKey } : {}),
      },
      select: { id: true, status: true, scheduledFor: true },
    });
  }

  list(status?: string) {
    return this.prisma.scanJob.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { api: { select: { id: true, name: true } } },
    });
  }

  listForApi(apiId: string) {
    return this.prisma.scanJob.findMany({
      where: { apiId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { api: { select: { id: true, name: true } } },
    });
  }

  async get(id: string) {
    const job = await this.prisma.scanJob.findUnique({ where: { id }, include: { api: { select: { id: true, name: true } } } });
    if (!job) throw new NotFoundException('Scan job not found');
    return job;
  }

  async claim(runnerId: string) {
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + this.leaseMs);
    const claimToken = randomUUID();
    return this.prisma.$transaction(async (transaction) => {
      const available = await transaction.scanJob.findFirst({
        where: {
          OR: [
            { status: { in: ['PENDING', 'RETRY_SCHEDULED'] }, scheduledFor: { lte: now } },
            { status: { in: ['CLAIMED', 'RUNNING'] }, leaseExpiresAt: { lte: now } },
          ],
        },
        orderBy: [{ scheduledFor: 'asc' }, { createdAt: 'asc' }],
      });
      if (!available) return null;
      const claimed = await transaction.scanJob.updateMany({
        where: {
          id: available.id,
          OR: [
            { status: { in: ['PENDING', 'RETRY_SCHEDULED'] }, scheduledFor: { lte: now } },
            { status: { in: ['CLAIMED', 'RUNNING'] }, leaseExpiresAt: { lte: now } },
          ],
        },
        data: {
          status: 'CLAIMED',
          attempt: { increment: 1 },
          claimedAt: now,
          startedAt: null,
          leaseExpiresAt,
          claimToken,
          runnerId,
        },
      });
      if (claimed.count !== 1) return null;
      const job = await transaction.scanJob.findUniqueOrThrow({
        where: { id: available.id },
        include: {
          api: {
            include: { snapshots: { orderBy: { createdAt: 'desc' }, take: 1 } },
          },
        },
      });
      const previous = job.api.snapshots[0];
      return {
        id: job.id,
        apiId: job.apiId,
        specUrl: job.api.specUrl,
        attempt: job.attempt,
        maxAttempts: job.maxAttempts,
        claimToken,
        leaseExpiresAt: leaseExpiresAt.toISOString(),
        previousSnapshot: previous
          ? { id: previous.id, contentHash: previous.contentHash, spec: JSON.parse(previous.rawSpec) as OpenApiDocument }
          : null,
      };
    });
  }

  async start(id: string, claimToken: string) {
    const now = new Date();
    return this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.scanJob.updateMany({
        where: { id, claimToken, status: 'CLAIMED', leaseExpiresAt: { gt: now } },
        data: { status: 'RUNNING', startedAt: now },
      });
      if (updated.count !== 1) throw new ConflictException('Job is not held by this runner');
      await transaction.scan.upsert({
        where: { jobId: id },
        create: { apiId: (await transaction.scanJob.findUniqueOrThrow({ where: { id } })).apiId, jobId: id, status: 'RUNNING' },
        update: { status: 'RUNNING', startedAt: now, completedAt: null, error: null },
      });
      return transaction.scanJob.findUniqueOrThrow({ where: { id } });
    });
  }

  async heartbeat(id: string, claimToken: string) {
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + this.leaseMs);
    const updated = await this.prisma.scanJob.updateMany({
      where: { id, claimToken, status: { in: ['CLAIMED', 'RUNNING'] }, leaseExpiresAt: { gt: now } },
      data: { leaseExpiresAt },
    });
    if (updated.count !== 1) throw new ConflictException('Job lease is no longer owned by this runner');
    return { id, leaseExpiresAt };
  }

  async complete(id: string, result: CompleteJobRequest) {
    return this.prisma.$transaction(async (transaction) => {
      const job = await transaction.scanJob.findUnique({ where: { id } });
      if (!job) throw new NotFoundException('Scan job not found');
      if (job.status === 'COMPLETED') return job;
      if (job.status !== 'RUNNING' || job.claimToken !== result.claimToken || !job.leaseExpiresAt || job.leaseExpiresAt <= new Date()) {
        throw new ConflictException('Job is not held by this runner');
      }

      const existing = await transaction.apiSnapshot.findUnique({ where: { apiId_contentHash: { apiId: job.apiId, contentHash: result.hash } } });
      if (!existing) {
        const latest = await transaction.apiSnapshot.findFirst({ where: { apiId: job.apiId }, orderBy: { createdAt: 'desc' } });
        if ((latest?.id ?? null) !== result.previousSnapshotId) throw new ConflictException('Snapshot baseline changed; retry the job');
        const snapshot = await transaction.apiSnapshot.create({ data: { apiId: job.apiId, contentHash: result.hash, rawSpec: JSON.stringify(result.spec) } });
        if (latest) {
          for (const change of result.changes as ContractChange[]) {
            await transaction.apiChange.create({ data: { apiId: job.apiId, previousSnapshotId: latest.id, currentSnapshotId: snapshot.id, severity: change.severity, category: change.category, path: change.path, method: change.method, description: change.description } });
          }
        }
      }

      const completedAt = new Date();
      await transaction.trackedApi.update({ where: { id: job.apiId }, data: { status: 'ACTIVE', lastCheckedAt: completedAt } });
      await transaction.scan.upsert({
        where: { jobId: id },
        create: { apiId: job.apiId, jobId: id, status: 'COMPLETED', completedAt },
        update: { status: 'COMPLETED', completedAt, error: null },
      });
      return transaction.scanJob.update({
        where: { id },
        data: { status: 'COMPLETED', completedAt, failedAt: null, lastError: null, leaseExpiresAt: null, claimToken: null, runnerId: null },
      });
    });
  }

  async fail(id: string, claimToken: string, error: string) {
    return this.prisma.$transaction(async (transaction) => {
      const job = await transaction.scanJob.findUnique({ where: { id } });
      if (!job) throw new NotFoundException('Scan job not found');
      if (['COMPLETED', 'FAILED', 'RETRY_SCHEDULED'].includes(job.status) && job.claimToken === null) return job;
      if (!['CLAIMED', 'RUNNING'].includes(job.status) || job.claimToken !== claimToken) throw new ConflictException('Job is not held by this runner');
      const retry = job.attempt < job.maxAttempts;
      const delay = RETRY_DELAYS_MS[Math.min(job.attempt - 1, RETRY_DELAYS_MS.length - 1)]!;
      const now = new Date();
      await transaction.scan.updateMany({ where: { jobId: id }, data: { status: retry ? 'RETRY_SCHEDULED' : 'FAILED', completedAt: now, error } });
      if (!retry) await transaction.trackedApi.update({ where: { id: job.apiId }, data: { status: 'ERROR', lastCheckedAt: now } });
      return transaction.scanJob.update({
        where: { id },
        data: {
          status: retry ? 'RETRY_SCHEDULED' : 'FAILED',
          scheduledFor: retry ? new Date(now.getTime() + delay) : job.scheduledFor,
          failedAt: retry ? null : now,
          lastError: error,
          claimToken: null,
          runnerId: null,
          leaseExpiresAt: null,
        },
      });
    });
  }
}
