import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { retryRoutingKey } from '@contrava/rabbitmq';
import type { CompleteJobRequest, ContractChange } from '@contrava/shared';
import type { Prisma, ScanJobStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JobRepository } from './job.repository';
import { createScanOutbox } from '../outbox/outbox-message';

const RETRY_DELAYS_MS = [5_000, 15_000, 60_000] as const;

@Injectable()
export class JobsService {
  private readonly leaseMs = Number(process.env.JOB_LEASE_MS ?? 30_000);
  private readonly defaultMaxAttempts = Number(process.env.MAX_JOB_ATTEMPTS ?? 4);

  constructor(private readonly prisma: PrismaService, private readonly repository: JobRepository) {}

  enqueue(apiId: string, source: 'MANUAL' | 'SCHEDULED' = 'MANUAL', scheduleKey?: string, correlationId: string = randomUUID()) {
    return this.prisma.$transaction(async (transaction) => {
      const job = await transaction.scanJob.create({
        data: { id: randomUUID(), apiId, correlationId, source, maxAttempts: this.defaultMaxAttempts, ...(scheduleKey ? { scheduleKey } : {}) },
      });
      await createScanOutbox(transaction, job);
      return { id: job.id, status: job.status, scheduledFor: job.scheduledFor };
    });
  }

  async list(page: number, pageSize: number, status?: ScanJobStatus) {
    const where = status ? { status } : undefined;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.scanJob.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { api: { select: { id: true, name: true } } },
      }),
      this.prisma.scanJob.count({ where }),
    ]);
    return { data, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  }

  async metrics() {
    const now = new Date();
    const [pending, retrying, claimed, running, failed, expiredLeases, oldest, outboxPending, outboxFailed, messagesPublished, deadLettered] = await this.prisma.$transaction([
      this.prisma.scanJob.count({ where: { status: 'PENDING' } }),
      this.prisma.scanJob.count({ where: { status: 'RETRY_SCHEDULED' } }),
      this.prisma.scanJob.count({ where: { status: 'CLAIMED' } }),
      this.prisma.scanJob.count({ where: { status: 'RUNNING' } }),
      this.prisma.scanJob.count({ where: { status: 'FAILED' } }),
      this.prisma.scanJob.count({ where: { status: { in: ['CLAIMED', 'RUNNING'] }, leaseExpiresAt: { lt: now } } }),
      this.prisma.scanJob.aggregate({ where: { status: { in: ['PENDING', 'RETRY_SCHEDULED'] } }, _min: { scheduledFor: true } }),
      this.prisma.outboxMessage.count({ where: { status: 'PENDING' } }),
      this.prisma.outboxMessage.count({ where: { status: 'FAILED' } }),
      this.prisma.outboxMessage.count({ where: { status: 'PUBLISHED' } }),
      this.prisma.scanJob.count({ where: { deadLetteredAt: { not: null } } }),
    ]);
    const oldestDate = oldest._min.scheduledFor;
    return {
      pending,
      retrying,
      active: claimed + running,
      failed,
      expiredLeases,
      oldestPendingAgeSeconds: oldestDate ? Math.max(0, Math.floor((now.getTime() - oldestDate.getTime()) / 1000)) : null,
      outboxPending,
      outboxFailed,
      messagesPublished,
      deadLettered,
    };
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

  claim(runnerId: string, maxJobs: number) {
    return this.repository.claimBatch(runnerId, maxJobs, this.leaseMs);
  }

  claimDelivery(id: string, runnerId: string) {
    return this.repository.claimById(id, runnerId, this.leaseMs);
  }

  markDeadLettered(id: string) {
    return this.prisma.scanJob.updateMany({ where: { id }, data: { deadLetteredAt: new Date() } });
  }

  async start(id: string, claimToken: string, runnerId: string) {
    const now = new Date();
    return this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.scanJob.updateMany({
        where: { id, claimToken, runnerId, status: 'CLAIMED', leaseExpiresAt: { gt: now } },
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

  async heartbeat(id: string, claimToken: string, runnerId: string) {
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + this.leaseMs);
    const updated = await this.prisma.scanJob.updateMany({
      where: { id, claimToken, runnerId, status: { in: ['CLAIMED', 'RUNNING'] }, leaseExpiresAt: { gt: now } },
      data: { leaseExpiresAt },
    });
    if (updated.count !== 1) throw new ConflictException('Job lease is no longer owned by this runner');
    return { id, leaseExpiresAt };
  }

  async complete(id: string, result: CompleteJobRequest) {
    return this.prisma.$transaction(async (transaction) => {
      const job = await transaction.scanJob.findUnique({ where: { id } });
      if (!job) throw new NotFoundException('Scan job not found');
      if (job.status === 'COMPLETED' && job.claimToken === result.claimToken && job.runnerId === result.runnerId) return job;
      if (job.status !== 'RUNNING' || job.claimToken !== result.claimToken || job.runnerId !== result.runnerId || !job.leaseExpiresAt || job.leaseExpiresAt <= new Date()) {
        throw new ConflictException('Job is not held by this runner');
      }

      // Serialize snapshot-baseline mutation per API while keeping worker HTTP calls outside this transaction.
      await this.repository.lockApiForSnapshot(transaction, job.apiId);
      const existing = await transaction.apiSnapshot.findUnique({ where: { apiId_contentHash: { apiId: job.apiId, contentHash: result.hash } } });
      if (!existing) {
        const latest = await transaction.apiSnapshot.findFirst({ where: { apiId: job.apiId }, orderBy: { createdAt: 'desc' } });
        if ((latest?.id ?? null) !== result.previousSnapshotId) throw new ConflictException('Snapshot baseline changed; retry the job');
        const snapshot = await transaction.apiSnapshot.create({ data: { apiId: job.apiId, contentHash: result.hash, rawSpec: JSON.parse(JSON.stringify(result.spec)) as Prisma.InputJsonValue } });
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
        data: { status: 'COMPLETED', completedAt, failedAt: null, lastError: null, leaseExpiresAt: null },
      });
    });
  }

  async fail(id: string, claimToken: string, runnerId: string, error: string) {
    return this.prisma.$transaction(async (transaction) => {
      const job = await transaction.scanJob.findUnique({ where: { id } });
      if (!job) throw new NotFoundException('Scan job not found');
      if (job.status === 'COMPLETED' && job.claimToken === claimToken && job.runnerId === runnerId) return job;
      if (['FAILED', 'RETRY_SCHEDULED'].includes(job.status) && job.claimToken === null) return job;
      if (!['CLAIMED', 'RUNNING'].includes(job.status) || job.claimToken !== claimToken || job.runnerId !== runnerId) throw new ConflictException('Job is not held by this runner');
      const retry = job.attempt < job.maxAttempts;
      const delay = RETRY_DELAYS_MS[Math.min(job.attempt - 1, RETRY_DELAYS_MS.length - 1)]!;
      const now = new Date();
      await transaction.scan.updateMany({ where: { jobId: id }, data: { status: retry ? 'RETRY_SCHEDULED' : 'FAILED', completedAt: now, error } });
      if (retry) await createScanOutbox(transaction, job, 'retry', retryRoutingKey(job.attempt));
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
