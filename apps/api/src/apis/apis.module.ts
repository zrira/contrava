import { Module } from '@nestjs/common';
import { ScansModule } from '../scans/scans.module';
import { ApisController } from './apis.controller';
import { ApisService } from './apis.service';

@Module({ imports: [ScansModule], controllers: [ApisController], providers: [ApisService], exports: [ApisService] })
export class ApisModule {}
