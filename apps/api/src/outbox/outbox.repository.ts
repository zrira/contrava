import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

interface LockedRow { id: string; lockToken: string }

@Injectable()
export class OutboxRepository {
  constructor(private readonly prisma: PrismaService) {}

  claimBatch(limit: number, lockMs = 30_000) {
    const capacity = Math.max(1, Math.min(200, Math.trunc(limit)));
    const now = new Date();
    const staleBefore = new Date(now.getTime() - lockMs);
    return this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<LockedRow[]>`
        WITH candidates AS (
          SELECT "id"
          FROM "OutboxMessage"
          WHERE "status" = 'PENDING'::"OutboxStatus"
            AND "availableAt" <= ${now}
            AND ("lockedAt" IS NULL OR "lockedAt" < ${staleBefore})
          ORDER BY "createdAt" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT ${capacity}
        )
        UPDATE "OutboxMessage" AS message
        SET "lockedAt" = ${now},
            "lockToken" = gen_random_uuid(),
            "attemptCount" = message."attemptCount" + 1,
            "updatedAt" = ${now}
        FROM candidates
        WHERE message."id" = candidates."id"
        RETURNING message."id", message."lockToken"
      `;
      if (!rows.length) return [];
      const messages = await transaction.outboxMessage.findMany({ where: { id: { in: rows.map((row) => row.id) } } });
      const tokens = new Map(rows.map((row) => [row.id, row.lockToken]));
      return messages.map((message) => ({ ...message, lockToken: tokens.get(message.id)! }));
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  markPublished(id: string, lockToken: string) {
    return this.prisma.outboxMessage.updateMany({ where: { id, lockToken, status: 'PENDING' }, data: { status: 'PUBLISHED', publishedAt: new Date(), lockedAt: null, lockToken: null, lastError: null } });
  }

  release(id: string, lockToken: string, error: string) {
    return this.prisma.outboxMessage.updateMany({ where: { id, lockToken, status: 'PENDING' }, data: { lockedAt: null, lockToken: null, lastError: error.slice(0, 2000) } });
  }
}
