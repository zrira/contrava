import { Controller, Get } from '@nestjs/common';
import { OutboxPublisherService } from '../outbox/outbox-publisher.service';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService, private readonly publisher: OutboxPublisherService) {}

  @Get()
  async health() {
    const databaseStarted = performance.now();
    const [databaseLatencyMs, outboxPending, outboxFailed, rabbitmq] = await Promise.all([
      this.prisma.$queryRaw`SELECT 1`.then(() => Math.round(performance.now() - databaseStarted)),
      this.prisma.outboxMessage.count({ where: { status: 'PENDING' } }),
      this.prisma.outboxMessage.count({ where: { status: 'PENDING', lastError: { not: null } } }),
      this.publisher.health(),
    ]);
    return {
      status: rabbitmq.status === 'UNAVAILABLE' ? 'degraded' : 'ok',
      service: 'api',
      database: { status: 'HEALTHY', latencyMs: databaseLatencyMs },
      rabbitmq,
      outbox: { pending: outboxPending, failed: outboxFailed },
    };
  }
}
