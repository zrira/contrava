import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
import type { CorrelatedRequest } from '../common/correlation-id.middleware';
import { ScansService } from '../scans/scans.service';
import { ApisService } from './apis.service';
import { CreateApiDto, UpdateApiDto } from './dto';

@Controller('apis')
export class ApisController {
  constructor(private readonly apis: ApisService, private readonly scans: ScansService) {}
  @Get() list() { return this.apis.list(); }
  @Post() create(@Body() body: CreateApiDto) { return this.apis.create(body); }
  @Get(':id') get(@Param('id') id: string) { return this.apis.get(id); }
  @Patch(':id') update(@Param('id') id: string, @Body() body: UpdateApiDto) { return this.apis.update(id, body); }
  @Delete(':id') @HttpCode(204) remove(@Param('id') id: string) { return this.apis.remove(id); }
  @Post(':id/scan') scan(@Param('id') id: string, @Req() request: CorrelatedRequest) { return this.scans.run(id, request.requestId); }
}
