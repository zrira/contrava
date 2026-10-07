import { Controller, Get, Param } from '@nestjs/common';
import { ScansService } from './scans.service';
@Controller('scans')
export class ScansController {
  constructor(private readonly scans: ScansService) {}
  @Get() list() { return this.scans.list(); }
  @Get(':id') get(@Param('id') id: string) { return this.scans.get(id); }
}
