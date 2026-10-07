import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { UpdateScheduleDto } from '../scheduler/schedule.dto';
import type { CreateApiDto, UpdateApiDto } from './dto';

@Injectable()
export class ApisService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const apis = await this.prisma.trackedApi.findMany({ orderBy: { createdAt: 'desc' }, include: { snapshots: { orderBy: { createdAt: 'desc' }, take: 1 }, _count: { select: { changes: { where: { severity: 'BREAKING' } } } } } });
    return apis.map(({ snapshots, _count, ...api }) => ({ ...api, currentVersionHash: snapshots[0]?.contentHash ?? null, breakingChangesCount: _count.changes }));
  }

  async create(data: CreateApiDto) { return this.prisma.trackedApi.create({ data }); }

  async get(id: string) {
    const api = await this.prisma.trackedApi.findUnique({ where: { id }, include: { snapshots: { orderBy: { createdAt: 'desc' }, take: 1 }, _count: { select: { changes: { where: { severity: 'BREAKING' } } } } } });
    if (!api) throw new NotFoundException('Tracked API not found');
    const { snapshots, _count, ...details } = api;
    return { ...details, currentVersionHash: snapshots[0]?.contentHash ?? null, breakingChangesCount: _count.changes };
  }

  async update(id: string, data: UpdateApiDto) {
    await this.get(id);
    return this.prisma.trackedApi.update({ where: { id }, data: data as Prisma.TrackedApiUpdateInput });
  }

  async updateSchedule(id: string, data: UpdateScheduleDto) {
    await this.get(id);
    return this.prisma.trackedApi.update({
      where: { id },
      data: {
        scanEnabled: data.scanEnabled,
        scanIntervalMinutes: data.scanIntervalMinutes,
        nextScanAt: data.scanEnabled ? new Date() : null,
      },
    });
  }

  async remove(id: string) { await this.get(id); await this.prisma.trackedApi.delete({ where: { id } }); }
}
