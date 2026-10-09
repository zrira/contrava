import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { ApisModule } from './apis/apis.module';
import { ChangesModule } from './changes/changes.module';
import { CorrelationIdMiddleware } from './common/correlation-id.middleware';
import { HealthModule } from './health/health.module';
import { JobsModule } from './jobs/jobs.module';
import { OutboxModule } from './outbox/outbox.module';
import { PrismaModule } from './prisma/prisma.module';
import { ScansModule } from './scans/scans.module';
import { RepositoriesModule } from './repositories/repositories.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { SnapshotsModule } from './snapshots/snapshots.module';
import { WorkersModule } from './workers/workers.module';

@Module({ imports: [PrismaModule, OutboxModule, JobsModule, SchedulerModule, ApisModule, RepositoriesModule, SnapshotsModule, ChangesModule, ScansModule, WorkersModule, HealthModule] })
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void { consumer.apply(CorrelationIdMiddleware).forRoutes('*'); }
}
