import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ScansService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.scan.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { api: { select: { id: true, name: true } } },
    });
  }

  async get(id: string) {
    const scan = await this.prisma.scan.findUnique({
      where: { id },
      include: { api: { select: { id: true, name: true } } },
    });
    if (!scan) throw new NotFoundException('Scan not found');
    return scan;
  }
}
