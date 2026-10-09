import { Injectable } from '@nestjs/common';
import type { JobDeliveryDisposition, OpenApiDocument } from '@contrava/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

interface ClaimedRow {
  id: string;
}

@Injectable()
export class JobRepository {
  constructor(private readonly prisma: PrismaService) {}

  async lockApiForSnapshot(transaction: Prisma.TransactionClient, apiId: string): Promise<void> {
    await transaction.$queryRaw`SELECT "id" FROM "TrackedApi" WHERE "id" = ${apiId}::uuid FOR UPDATE`;
  }

  async claimById(jobId: string, runnerId: string, leaseMs: number): Promise<JobDeliveryDisposition> {
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + leaseMs);
    return this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<ClaimedRow[]>`
        WITH candidate AS (
          SELECT "id"
          FROM "ScanJob"
          WHERE "id" = ${jobId}::uuid
            AND (
              ("status" IN ('PENDING'::"ScanJobStatus", 'RETRY_SCHEDULED'::"ScanJobStatus") AND "scheduledFor" <= ${now})
              OR ("status" IN ('CLAIMED'::"ScanJobStatus", 'RUNNING'::"ScanJobStatus") AND "leaseExpiresAt" <= ${now})
            )
          FOR UPDATE
        )
        UPDATE "ScanJob" AS job
        SET "status" = 'CLAIMED'::"ScanJobStatus",
            "redeliveryCount" = job."redeliveryCount" + CASE WHEN job."attempt" > 0 THEN 1 ELSE 0 END,
            "attempt" = job."attempt" + 1,
            "claimedAt" = ${now},
            "lastDeliveredAt" = ${now},
            "startedAt" = NULL,
            "leaseExpiresAt" = ${leaseExpiresAt},
            "claimToken" = gen_random_uuid(),
            "runnerId" = ${runnerId},
            "updatedAt" = ${now}
        FROM candidate
        WHERE job."id" = candidate."id"
        RETURNING job."id"
      `;
      if (rows.length) return { disposition: 'CLAIMED', job: await this.hydrateClaim(transaction, jobId) };
      const current = await transaction.scanJob.findUnique({ where: { id: jobId } });
      if (!current) return { disposition: 'NOT_FOUND' };
      if (current.status === 'COMPLETED') return { disposition: 'COMPLETED' };
      if (current.status === 'FAILED') return { disposition: 'TERMINAL' };
      const availableAt = current.status === 'RETRY_SCHEDULED' ? current.scheduledFor : current.leaseExpiresAt;
      const retryAfterMs = availableAt ? Math.max(250, availableAt.getTime() - now.getTime()) : 1000;
      return { disposition: 'BUSY', retryAfterMs };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  private async hydrateClaim(transaction: Prisma.TransactionClient, id: string) {
    const job = await transaction.scanJob.findUniqueOrThrow({
      where: { id },
      include: { api: { include: { snapshots: { orderBy: { createdAt: 'desc' }, take: 1 } } } },
    });
    if (!job.claimToken || !job.runnerId || !job.leaseExpiresAt) throw new Error('Claimed job is missing ownership');
    const previous = job.api.snapshots[0];
    return {
      id: job.id,
      apiId: job.apiId,
      specUrl: job.api.specUrl,
      attempt: job.attempt,
      maxAttempts: job.maxAttempts,
      claimToken: job.claimToken,
      runnerId: job.runnerId,
      leaseExpiresAt: job.leaseExpiresAt.toISOString(),
      previousSnapshot: previous ? { id: previous.id, contentHash: previous.contentHash, spec: previous.rawSpec as unknown as OpenApiDocument } : null,
    };
  }

  /** PostgreSQL row locks make concurrent consumers skip work already being claimed. */
  claimBatch(runnerId: string, limit: number, leaseMs: number) {
    const capacity = Math.max(1, Math.min(50, Math.trunc(limit)));
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + leaseMs);
    const started = performance.now();
    return this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<ClaimedRow[]>`
        WITH candidates AS (
          SELECT "id"
          FROM "ScanJob"
          WHERE (
            "status" IN ('PENDING'::"ScanJobStatus", 'RETRY_SCHEDULED'::"ScanJobStatus")
            AND "scheduledFor" <= ${now}
          ) OR (
            "status" IN ('CLAIMED'::"ScanJobStatus", 'RUNNING'::"ScanJobStatus")
            AND "leaseExpiresAt" <= ${now}
          )
          ORDER BY "scheduledFor" ASC, "createdAt" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT ${capacity}
        )
        UPDATE "ScanJob" AS job
        SET "status" = 'CLAIMED'::"ScanJobStatus",
            "redeliveryCount" = job."redeliveryCount" + CASE WHEN job."attempt" > 0 THEN 1 ELSE 0 END,
            "attempt" = job."attempt" + 1,
            "claimedAt" = ${now},
            "lastDeliveredAt" = ${now},
            "startedAt" = NULL,
            "leaseExpiresAt" = ${leaseExpiresAt},
            "claimToken" = gen_random_uuid(),
            "runnerId" = ${runnerId},
            "updatedAt" = ${now}
        FROM candidates
        WHERE job."id" = candidates."id"
        RETURNING job."id"
      `;
      if (rows.length === 0) return [];
      const ids = rows.map(({ id }) => id);
      const claimed = await Promise.all(ids.map((id) => this.hydrateClaim(transaction, id)));
      console.info(JSON.stringify({ service: 'api', event: 'jobs claimed', transaction: 'claimBatch', runnerId, claimCount: claimed.length, durationMs: Math.round(performance.now() - started) }));
      return claimed;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }
}
