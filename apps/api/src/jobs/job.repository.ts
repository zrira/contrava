import { Injectable } from '@nestjs/common';
import type { OpenApiDocument } from '@contrava/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

interface ClaimedRow {
  id: string;
}

@Injectable()
export class JobRepository {
  constructor(private readonly prisma: PrismaService) {}

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
            "attempt" = job."attempt" + 1,
            "claimedAt" = ${now},
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
      const jobs = await transaction.scanJob.findMany({
        where: { id: { in: ids } },
        include: { api: { include: { snapshots: { orderBy: { createdAt: 'desc' }, take: 1 } } } },
      });
      const byId = new Map(jobs.map((job) => [job.id, job]));
      const claimed = ids.flatMap((id) => {
        const job = byId.get(id);
        if (!job?.claimToken || !job.runnerId) return [];
        const previous = job.api.snapshots[0];
        return [{
          id: job.id,
          apiId: job.apiId,
          specUrl: job.api.specUrl,
          attempt: job.attempt,
          maxAttempts: job.maxAttempts,
          claimToken: job.claimToken,
          runnerId: job.runnerId,
          leaseExpiresAt: job.leaseExpiresAt!.toISOString(),
          previousSnapshot: previous
            ? { id: previous.id, contentHash: previous.contentHash, spec: previous.rawSpec as unknown as OpenApiDocument }
            : null,
        }];
      });
      console.info(JSON.stringify({ service: 'api', event: 'jobs claimed', transaction: 'claimBatch', runnerId, claimCount: claimed.length, durationMs: Math.round(performance.now() - started) }));
      return claimed;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }
}
