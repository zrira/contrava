import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import type { CorrelatedRequest } from '../common/correlation-id.middleware';
import { CreateRepositoryDto, UsageQueryDto } from './repository.dto';
import { RepositoriesService } from './repositories.service';

@Controller('repositories')
export class RepositoriesController {
  constructor(private readonly repositories: RepositoriesService) {}
  @Get('metrics') metrics() { return this.repositories.metrics(); }
  @Get() list() { return this.repositories.list(); }
  @Post() create(@Body() body: CreateRepositoryDto) { return this.repositories.create(body); }
  @Get(':id') get(@Param('id') id: string) { return this.repositories.get(id); }
  @Delete(':id') @HttpCode(204) remove(@Param('id') id: string) { return this.repositories.remove(id); }
  @Post(':id/scan') async scan(@Param('id') id: string, @Req() request: CorrelatedRequest) { return this.repositories.enqueueScan(id, request.requestId); }
  @Get(':id/scans') scans(@Param('id') id: string) { return this.repositories.listScans(id); }
  @Get(':id/usages') usages(@Param('id') id: string, @Query() query: UsageQueryDto) { return this.repositories.usages(id, query); }
}
