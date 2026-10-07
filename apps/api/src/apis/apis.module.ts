import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { ApisController } from './apis.controller';
import { ApisService } from './apis.service';

@Module({ imports: [JobsModule], controllers: [ApisController], providers: [ApisService], exports: [ApisService] })
export class ApisModule {}
