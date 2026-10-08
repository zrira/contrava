import { Controller, Get, Param, Query } from '@nestjs/common';
import { JobsQueryDto } from './job.dto';
import { JobsService } from './jobs.service';

@Controller('jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}
  @Get() list(@Query() query: JobsQueryDto) { return this.jobs.list(query.page, query.pageSize, query.status); }
  @Get('metrics') metrics() { return this.jobs.metrics(); }
  @Get(':id') get(@Param('id') id: string) { return this.jobs.get(id); }
}
