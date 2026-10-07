import { Module } from '@nestjs/common';
import { WorkersModule } from '../workers/workers.module';
import { ScansController } from './scans.controller';
import { ScansService } from './scans.service';
@Module({ imports: [WorkersModule], controllers: [ScansController], providers: [ScansService], exports: [ScansService] })
export class ScansModule {}
