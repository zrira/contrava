import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
import type { CorrelatedRequest } from '../common/correlation-id.middleware';
import { JobsService } from '../jobs/jobs.service';
import { UpdateScheduleDto } from '../scheduler/schedule.dto';
import { ApisService } from './apis.service';
import { CreateApiDto, UpdateApiDto } from './dto';

@Controller('apis')
export class ApisController {
  constructor(private readonly apis: ApisService, private readonly jobs: JobsService) {}
  @Get() list() { return this.apis.list(); }
  @Post() create(@Body() body: CreateApiDto) { return this.apis.create(body); }
  @Get(':id') get(@Param('id') id: string) { return this.apis.get(id); }
  @Patch(':id') update(@Param('id') id: string, @Body() body: UpdateApiDto) { return this.apis.update(id, body); }
  @Patch(':id/schedule') schedule(@Param('id') id: string, @Body() body: UpdateScheduleDto) { return this.apis.updateSchedule(id, body); }
  @Delete(':id') @HttpCode(204) remove(@Param('id') id: string) { return this.apis.remove(id); }
  @Post(':id/scan') async scan(@Param('id') id: string, @Req() request: CorrelatedRequest) { await this.apis.get(id); const job = await this.jobs.enqueue(id, 'MANUAL', undefined, request.requestId); return { jobId: job.id, status: job.status }; }
  @Get(':id/jobs') async apiJobs(@Param('id') id: string) { await this.apis.get(id); return this.jobs.listForApi(id); }
}
