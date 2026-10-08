import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;
  private readonly intervalMs = Number(process.env.SCHEDULER_INTERVAL_MS ?? 10_000);
  private readonly maxAttempts = Number(process.env.MAX_JOB_ATTEMPTS ?? 3);

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref();
    void this.tick();
  }

  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }

  async tick(now = new Date()): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const due = await this.prisma.trackedApi.findMany({
        where: { scanEnabled: true, nextScanAt: { lte: now } },
        orderBy: { nextScanAt: 'asc' },
        take: 50,
        select: { id: true },
      });
      let created = 0;
      for (const { id } of due) if (await this.enqueueDue(id, now)) created += 1;
      return created;
    } finally { this.running = false; }
  }

  private enqueueDue(apiId: string, now: Date): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      const [api] = await transaction.$queryRaw<Array<{ id: string; nextScanAt: Date; scanIntervalMinutes: number }>>`
        SELECT "id", "nextScanAt", "scanIntervalMinutes"
        FROM "TrackedApi"
        WHERE "id" = ${apiId}::uuid
          AND "scanEnabled" = true
          AND "nextScanAt" <= ${now}
        FOR UPDATE
      `;
      if (!api) return false;
      const scheduleKey = `${api.id}:${api.nextScanAt.toISOString()}`;
      const nextScanAt = new Date(now.getTime() + api.scanIntervalMinutes * 60_000);
      await transaction.scanJob.create({
        data: { apiId: api.id, source: 'SCHEDULED', scheduleKey, scheduledFor: now, maxAttempts: this.maxAttempts },
      });
      await transaction.trackedApi.update({ where: { id: api.id }, data: { nextScanAt } });
      return true;
    });
  }
}
