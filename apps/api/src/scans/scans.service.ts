import { BadGatewayException, Injectable, NotFoundException } from '@nestjs/common';
import type { OpenApiDocument } from '@contrava/shared';
import { PrismaService } from '../prisma/prisma.service';
import { WorkerClientService } from '../workers/worker-client.service';

@Injectable()
export class ScansService {
  constructor(private readonly prisma: PrismaService, private readonly workers: WorkerClientService) {}

  list() { return this.prisma.scan.findMany({ orderBy: { createdAt: 'desc' }, take: 100, include: { api: { select: { id: true, name: true } } } }); }
  async get(id: string) { const scan = await this.prisma.scan.findUnique({ where: { id }, include: { api: { select: { id: true, name: true } } } }); if (!scan) throw new NotFoundException('Scan not found'); return scan; }

  async run(apiId: string, requestId: string) {
    const api = await this.prisma.trackedApi.findUnique({ where: { id: apiId } });
    if (!api) throw new NotFoundException('Tracked API not found');
    const scan = await this.prisma.scan.create({ data: { apiId, status: 'RUNNING' } });
    try {
      const fetched = await this.workers.fetchSpec(apiId, api.specUrl, requestId);
      const previous = await this.prisma.apiSnapshot.findFirst({ where: { apiId }, orderBy: { createdAt: 'desc' } });
      if (previous?.contentHash === fetched.hash) {
        return this.prisma.$transaction(async (transaction) => {
          await transaction.trackedApi.update({ where: { id: apiId }, data: { lastCheckedAt: new Date(), status: 'ACTIVE' } });
          return transaction.scan.update({ where: { id: scan.id }, data: { status: 'COMPLETED', completedAt: new Date() } });
        });
      }

      const changes = previous
        ? (await this.workers.diff(JSON.parse(previous.rawSpec) as OpenApiDocument, fetched.spec, requestId)).changes
        : [];

      return await this.prisma.$transaction(async (transaction) => {
        const snapshot = await transaction.apiSnapshot.create({ data: { apiId, contentHash: fetched.hash, rawSpec: JSON.stringify(fetched.spec) } });
        if (previous) {
          for (const change of changes) {
            await transaction.apiChange.create({ data: { apiId, previousSnapshotId: previous.id, currentSnapshotId: snapshot.id, severity: change.severity, category: change.category, path: change.path, method: change.method, description: change.description } });
          }
        }
        await transaction.trackedApi.update({ where: { id: apiId }, data: { lastCheckedAt: new Date(), status: 'ACTIVE' } });
        return transaction.scan.update({ where: { id: scan.id }, data: { status: 'COMPLETED', completedAt: new Date() } });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown scan error';
      await this.prisma.$transaction([
        this.prisma.scan.update({ where: { id: scan.id }, data: { status: 'FAILED', error: message, completedAt: new Date() } }),
        this.prisma.trackedApi.update({ where: { id: apiId }, data: { status: 'ERROR', lastCheckedAt: new Date() } }),
      ]);
      throw new BadGatewayException(`Scan failed: ${message}`);
    }
  }
}
