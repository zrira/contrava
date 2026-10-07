import { Controller, Get, Param } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('apis/:apiId/changes')
export class ChangesController {
  constructor(private readonly prisma: PrismaService) {}
  @Get() list(@Param('apiId') apiId: string) { return this.prisma.apiChange.findMany({ where: { apiId }, orderBy: { createdAt: 'desc' } }); }
}
