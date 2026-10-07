import { Controller, Get, Param } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('apis/:apiId/snapshots')
export class SnapshotsController {
  constructor(private readonly prisma: PrismaService) {}
  @Get() list(@Param('apiId') apiId: string) { return this.prisma.apiSnapshot.findMany({ where: { apiId }, orderBy: { createdAt: 'desc' }, select: { id: true, apiId: true, contentHash: true, createdAt: true, currentChanges: { orderBy: { createdAt: 'asc' } } } }); }
}
