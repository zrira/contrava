import { Controller, Get, Req } from '@nestjs/common';
import type { CorrelatedRequest } from '../common/correlation-id.middleware';
import { WorkerClientService } from './worker-client.service';

@Controller('workers')
export class WorkersController {
  constructor(private readonly workers: WorkerClientService) {}
  @Get() list(@Req() request: CorrelatedRequest) {
    return Promise.all(this.workers.workerDefinitions().map(({ name, baseUrl }) => this.workers.health(name, baseUrl, request.requestId)));
  }
}
