import { Module } from '@nestjs/common';
import { InternalJobsController } from './internal-jobs.controller';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';

@Module({ controllers: [JobsController, InternalJobsController], providers: [JobsService], exports: [JobsService] })
export class JobsModule {}
