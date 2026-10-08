import { Module } from '@nestjs/common';
import { InternalJobsController } from './internal-jobs.controller';
import { JobsController } from './jobs.controller';
import { JobRepository } from './job.repository';
import { JobsService } from './jobs.service';

@Module({ controllers: [JobsController, InternalJobsController], providers: [JobsService, JobRepository], exports: [JobsService] })
export class JobsModule {}
