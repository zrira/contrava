import { Module } from '@nestjs/common';
import { WorkerClientService } from './worker-client.service';
import { WorkersController } from './workers.controller';

@Module({ controllers: [WorkersController], providers: [WorkerClientService], exports: [WorkerClientService] })
export class WorkersModule {}
