import { Controller, Get } from '@nestjs/common';
import { OutboxPublisherService } from '../outbox/outbox-publisher.service';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService, private readonly publisher: OutboxPublisherService) {}

  @Get()
  async health() {
    const started = performance.now();
    const [, outboxPending, outboxFailed, rabbitmq] = await Promise.all([
      this.prisma.$queryRaw`SELECT 1`,
      this.prisma.outboxMessage.count({ where: { status: 'PENDING' } }),
      this.prisma.outboxMessage.count({ where: { status: 'FAILED' } }),
      this.publisher.health(),
    ]);
    return {
      status: rabbitmq.status === 'HEALTHY' ? 'ok' : 'degraded',
      service: 'api',
      database: { status: 'HEALTHY', latencyMs: Math.round(performance.now() - started) },
      rabbitmq,
      outbox: { pending: outboxPending, failed: outboxFailed },
    };
  }
}
