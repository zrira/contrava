import { Controller, Get, Param, Query } from '@nestjs/common';
import { JobsService } from './jobs.service';

@Controller('jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}
  @Get() list(@Query('status') status?: string) { return this.jobs.list(status); }
  @Get(':id') get(@Param('id') id: string) { return this.jobs.get(id); }
}
