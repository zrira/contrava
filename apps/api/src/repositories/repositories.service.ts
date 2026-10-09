import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { repositoryRetryRoutingKey } from '@contrava/rabbitmq';
import type { CompleteRepositoryScanRequest, IndexedSourceFile, RepositoryScanDisposition } from '@contrava/shared';
import { Prisma, type RepositoryScan } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { createRepositoryScanOutbox } from '../outbox/repository-outbox-message';
import { rebuildUsageAssociations } from './usage-association';
import type { CreateRepositoryDto, FailRepositoryScanDto, UsageQueryDto } from './repository.dto';

const RETRY_DELAYS = [15_000, 60_000, 300_000] as const;
const SCANNER_VERSION = '1';

function validFiles(value: unknown[]): value is IndexedSourceFile[] {
  return value.every((file) => {
    if (!file || typeof file !== 'object' || Array.isArray(file)) return false;
    const candidate = file as Record<string, unknown>;
    return typeof candidate.path === 'string' && typeof candidate.language === 'string' && typeof candidate.contentHash === 'string' && Array.isArray(candidate.usages);
  });
}

@Injectable()
export class RepositoriesService {
  private readonly leaseMs = Number(process.env.REPO_SCAN_LEASE_MS ?? 60_000);
  private readonly maxFiles = Number(process.env.REPO_MAX_FILES ?? 5_000);
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.repository.findMany({ orderBy: { createdAt: 'desc' }, include: {
      _count: { select: { sourceFiles: true, usages: { where: { apiId: null } }, apiLinks: true } },
      scans: { orderBy: { createdAt: 'desc' }, take: 1 },
    } });
  }

  async get(id: string) {
    const repository = await this.prisma.repository.findUnique({ where: { id }, include: {
      _count: { select: { sourceFiles: true, usages: { where: { apiId: null } }, apiLinks: true } },
      apiLinks: { include: { api: { select: { id: true, name: true } } } },
      scans: { orderBy: { createdAt: 'desc' }, take: 10 },
    } });
    if (!repository) throw new NotFoundException('Repository not found');
    return repository;
  }

  create(input: CreateRepositoryDto) {
    const owner = input.owner.trim(); const name = input.name.trim();
    return this.prisma.repository.create({ data: { owner, name, fullName: `${owner}/${name}`, selectedBranch: input.selectedBranch?.trim() } });
  }
  async remove(id: string) { await this.get(id); return this.prisma.repository.delete({ where: { id } }); }

  async enqueueScan(repositoryId: string, correlationId: string) {
    return this.prisma.$transaction(async (transaction) => {
      const locked = await transaction.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Repository" WHERE "id" = ${repositoryId}::uuid FOR UPDATE`;
      if (!locked.length) throw new NotFoundException('Repository not found');
      const repository = await transaction.repository.findUniqueOrThrow({ where: { id: repositoryId } });
      const existing = await transaction.repositoryScan.findFirst({ where: { repositoryId, activeKey: repositoryId } });
      if (existing) return existing;
      const scan = await transaction.repositoryScan.create({ data: { repositoryId, activeKey: repositoryId, baseCommitSha: repository.lastIndexedCommitSha, scannerVersion: SCANNER_VERSION } });
      await createRepositoryScanOutbox(transaction, scan, correlationId);
      return scan;
    });
  }

  listScans(repositoryId: string) { return this.prisma.repositoryScan.findMany({ where: { repositoryId }, orderBy: { createdAt: 'desc' }, take: 100 }); }

  async link(apiId: string, repositoryId: string) {
    return this.prisma.$transaction(async (transaction) => {
      await Promise.all([transaction.trackedApi.findUniqueOrThrow({ where: { id: apiId } }), transaction.repository.findUniqueOrThrow({ where: { id: repositoryId } })]);
      const link = await transaction.apiRepositoryLink.upsert({ where: { apiId_repositoryId: { apiId, repositoryId } }, create: { apiId, repositoryId }, update: {} });
      await rebuildUsageAssociations(transaction, repositoryId);
      return link;
    });
  }
  async unlink(apiId: string, repositoryId: string) {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.apiRepositoryLink.deleteMany({ where: { apiId, repositoryId } });
      await transaction.apiUsage.deleteMany({ where: { apiId, repositoryId } });
      await transaction.impactFinding.deleteMany({ where: { repositoryId, apiChange: { apiId } } });
    });
  }

  async usages(repositoryId: string, query: UsageQueryDto) {
    const where: Prisma.ApiUsageWhereInput = {
      repositoryId,
      apiId: query.apiId ?? null,
      ...(query.method ? { httpMethod: query.method.toUpperCase() } : {}),
      ...(query.path ? { endpointPattern: { contains: query.path, mode: 'insensitive' } } : {}),
      ...(query.confidence ? { confidence: query.confidence } : {}),
      ...(query.file ? { sourceFile: { path: { contains: query.file, mode: 'insensitive' } } } : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.apiUsage.findMany({ where, include: { sourceFile: { select: { path: true, lastIndexedCommitSha: true } }, api: { select: { id: true, name: true } } }, orderBy: [{ sourceFile: { path: 'asc' } }, { line: 'asc' }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      this.prisma.apiUsage.count({ where }),
    ]);
    return { data, pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) } };
  }

  async claim(scanId: string, runnerId: string): Promise<RepositoryScanDisposition> {
    const now = new Date(); const leaseExpiresAt = new Date(now.getTime() + this.leaseMs);
    return this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<Array<{ id: string }>>`
        WITH candidate AS (
          SELECT "id" FROM "RepositoryScan" WHERE "id" = ${scanId}::uuid AND (
            ("status" IN ('PENDING'::"RepositoryScanStatus", 'RETRY_SCHEDULED'::"RepositoryScanStatus", 'RATE_LIMITED'::"RepositoryScanStatus") AND "scheduledFor" <= ${now})
            OR ("status" = 'RUNNING'::"RepositoryScanStatus" AND "leaseExpiresAt" <= ${now})
          ) FOR UPDATE
        ) UPDATE "RepositoryScan" AS scan SET "status"='RUNNING'::"RepositoryScanStatus", "attempt"=scan."attempt"+1,
          "startedAt"=${now}, "leaseExpiresAt"=${leaseExpiresAt}, "claimToken"=gen_random_uuid(), "runnerId"=${runnerId}, "updatedAt"=${now}
        FROM candidate WHERE scan."id"=candidate."id" RETURNING scan."id"`;
      if (rows.length) {
        const scan = await transaction.repositoryScan.findUniqueOrThrow({ where: { id: scanId }, include: { repository: true } });
        return { disposition: 'CLAIMED', scan: { scanId: scan.id, repositoryId: scan.repositoryId, owner: scan.repository.owner, name: scan.repository.name, branch: scan.repository.selectedBranch ?? scan.repository.defaultBranch, commitSha: scan.commitSha, previousCommitSha: scan.baseCommitSha, attempt: scan.attempt, maxAttempts: scan.maxAttempts, claimToken: scan.claimToken!, runnerId: scan.runnerId!, leaseExpiresAt: scan.leaseExpiresAt!.toISOString() } };
      }
      const scan = await transaction.repositoryScan.findUnique({ where: { id: scanId } });
      if (!scan) return { disposition: 'NOT_FOUND' };
      if (scan.status === 'COMPLETED') return { disposition: 'COMPLETED' };
      if (scan.status === 'FAILED') return { disposition: 'TERMINAL' };
      const available = scan.scheduledFor > now ? scan.scheduledFor : scan.leaseExpiresAt;
      return { disposition: 'BUSY', retryAfterMs: available ? Math.max(250, available.getTime() - now.getTime()) : 1000 };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  async resolve(scanId: string, claimToken: string, runnerId: string, metadata: { commitSha: string; defaultBranch: string; externalRepositoryId: string }) {
    return this.prisma.$transaction(async (transaction) => {
      const scan = await this.owned(transaction, scanId, claimToken, runnerId);
      const duplicate = await transaction.repositoryScan.findFirst({ where: { repositoryId: scan.repositoryId, commitSha: metadata.commitSha, scannerVersion: scan.scannerVersion, status: 'COMPLETED', id: { not: scan.id } } });
      await transaction.repository.update({ where: { id: scan.repositoryId }, data: { defaultBranch: metadata.defaultBranch, externalRepositoryId: metadata.externalRepositoryId, headCommitSha: metadata.commitSha } });
      if (duplicate) {
        await transaction.repositoryScan.update({ where: { id: scan.id }, data: { status: 'COMPLETED', commitSha: metadata.commitSha, completedAt: new Date(), activeKey: null, leaseExpiresAt: null, claimToken: null, runnerId: null, filesScanned: 0, fullScan: false } });
        return { alreadyIndexed: true };
      }
      await transaction.repositoryScan.update({ where: { id: scan.id }, data: { commitSha: metadata.commitSha } });
      return { alreadyIndexed: false };
    });
  }

  async heartbeat(scanId: string, claimToken: string, runnerId: string) {
    const now = new Date(); const leaseExpiresAt = new Date(now.getTime() + this.leaseMs);
    const updated = await this.prisma.repositoryScan.updateMany({ where: { id: scanId, claimToken, runnerId, status: 'RUNNING', leaseExpiresAt: { gt: now } }, data: { leaseExpiresAt } });
    if (updated.count !== 1) throw new ConflictException('Repository scan lease is no longer owned');
    return { scanId, leaseExpiresAt };
  }

  async complete(scanId: string, input: CompleteRepositoryScanRequest) {
    if (!validFiles(input.files) || input.files.length > this.maxFiles || input.indexedPaths.length > this.maxFiles) throw new ConflictException('Invalid or oversized repository index result');
    return this.prisma.$transaction(async (transaction) => {
      const scan = await this.owned(transaction, scanId, input.claimToken, input.runnerId);
      if (scan.commitSha !== input.commitSha) throw new ConflictException('Repository scan commit does not match resolved commit');
      const removePaths = new Set(input.deletedPaths);
      if (input.fullScan) {
        const existing = await transaction.sourceFile.findMany({ where: { repositoryId: scan.repositoryId }, select: { path: true } });
        const present = new Set(input.indexedPaths);
        for (const file of existing) if (!present.has(file.path)) removePaths.add(file.path);
      }
      if (removePaths.size) await transaction.sourceFile.deleteMany({ where: { repositoryId: scan.repositoryId, path: { in: [...removePaths] } } });
      for (const file of input.files) {
        const stored = await transaction.sourceFile.upsert({ where: { repositoryId_path: { repositoryId: scan.repositoryId, path: file.path } }, create: { repositoryId: scan.repositoryId, path: file.path, language: file.language, contentHash: file.contentHash, lastIndexedCommitSha: input.commitSha }, update: { language: file.language, contentHash: file.contentHash, lastIndexedCommitSha: input.commitSha } });
        await transaction.apiUsage.deleteMany({ where: { sourceFileId: stored.id } });
        if (file.usages.length) await transaction.apiUsage.createMany({ data: file.usages.map((usage) => ({ repositoryId: scan.repositoryId, sourceFileId: stored.id, apiId: null, httpMethod: usage.httpMethod, endpointPattern: usage.endpointPattern, line: usage.line, column: usage.column, snippet: usage.snippet.slice(0, 1200), confidence: usage.confidence, matchType: usage.matchType, evidence: usage.evidence as Prisma.InputJsonValue })) });
      }
      await rebuildUsageAssociations(transaction, scan.repositoryId);
      const usagesFound = await transaction.apiUsage.count({ where: { repositoryId: scan.repositoryId, apiId: null } });
      const completedAt = new Date();
      await transaction.repository.update({ where: { id: scan.repositoryId }, data: { status: 'ACTIVE', defaultBranch: input.defaultBranch, externalRepositoryId: input.externalRepositoryId, headCommitSha: input.commitSha, lastIndexedCommitSha: input.commitSha, lastIndexedAt: completedAt } });
      return transaction.repositoryScan.update({ where: { id: scan.id }, data: { status: 'COMPLETED', completedAt, activeKey: null, leaseExpiresAt: null, claimToken: null, runnerId: null, error: null, filesScanned: input.files.length, filesSkipped: input.filesSkipped, usagesFound, fullScan: input.fullScan } });
    }, { timeout: 30_000 });
  }

  async fail(scanId: string, claimToken: string, runnerId: string, input: FailRepositoryScanDto, correlationId: string) {
    return this.prisma.$transaction(async (transaction) => {
      const scan = await this.owned(transaction, scanId, claimToken, runnerId);
      const retry = input.retryable && scan.attempt < scan.maxAttempts;
      const now = new Date();
      const requested = input.retryAt ? new Date(input.retryAt) : null;
      const scheduledFor = requested && !Number.isNaN(requested.getTime()) && requested > now ? requested : new Date(now.getTime() + RETRY_DELAYS[Math.min(scan.attempt - 1, RETRY_DELAYS.length - 1)]!);
      const status = retry ? (input.rateLimited ? 'RATE_LIMITED' : 'RETRY_SCHEDULED') : 'FAILED';
      const updated = await transaction.repositoryScan.update({ where: { id: scan.id }, data: { status, scheduledFor, rateLimitResetAt: input.rateLimited ? scheduledFor : null, error: input.error.slice(0, 2000), activeKey: retry ? scan.repositoryId : null, claimToken: null, runnerId: null, leaseExpiresAt: null, completedAt: retry ? null : now } });
      if (retry) await createRepositoryScanOutbox(transaction, updated, correlationId, input.rateLimited ? { availableAt: scheduledFor } : { routingKey: repositoryRetryRoutingKey(scan.attempt) });
      else await transaction.repository.update({ where: { id: scan.repositoryId }, data: { status: 'ERROR' } });
      return updated;
    });
  }

  private async owned(transaction: Prisma.TransactionClient, scanId: string, claimToken: string, runnerId: string): Promise<RepositoryScan> {
    const scan = await transaction.repositoryScan.findUnique({ where: { id: scanId } });
    if (!scan) throw new NotFoundException('Repository scan not found');
    if (scan.status !== 'RUNNING' || scan.claimToken !== claimToken || scan.runnerId !== runnerId || !scan.leaseExpiresAt || scan.leaseExpiresAt <= new Date()) throw new ConflictException('Repository scan is not held by this runner');
    return scan;
  }

  async metrics() {
    const [repositories, running, impactedChanges, affectedRepositories, highConfidence] = await this.prisma.$transaction([
      this.prisma.repository.count(), this.prisma.repositoryScan.count({ where: { status: 'RUNNING' } }),
      this.prisma.apiChange.count({ where: { impactFindings: { some: {} } } }),
      this.prisma.impactFinding.groupBy({ by: ['repositoryId'], orderBy: { repositoryId: 'asc' } }),
      this.prisma.impactFinding.count({ where: { confidence: 'HIGH' } }),
    ]);
    return { repositories, repositoryScansRunning: running, breakingChangesWithImpact: impactedChanges, affectedRepositories: affectedRepositories.length, highConfidenceFindings: highConfidence };
  }
}
