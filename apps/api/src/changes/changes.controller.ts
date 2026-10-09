import { Controller, Get, Param } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('apis/:apiId/changes')
export class ChangesController {
  constructor(private readonly prisma: PrismaService) {}
  @Get() list(@Param('apiId') apiId: string) { return this.prisma.apiChange.findMany({ where: { apiId }, orderBy: { createdAt: 'desc' }, include: { _count: { select: { impactFindings: true } } } }); }
  @Get(':changeId/impact') async impact(@Param('apiId') apiId: string, @Param('changeId') changeId: string) {
    const findings = await this.prisma.impactFinding.findMany({ where: { apiChangeId: changeId, apiChange: { apiId } }, include: { repository: { select: { id: true, fullName: true, headCommitSha: true, lastIndexedCommitSha: true } }, apiUsage: { select: { snippet: true, matchType: true, evidence: true } } }, orderBy: [{ repository: { fullName: 'asc' } }, { path: 'asc' }, { line: 'asc' }] });
    const repositories = new Set(findings.map((finding) => finding.repositoryId)).size;
    const files = new Set(findings.map((finding) => `${finding.repositoryId}:${finding.path}`)).size;
    return { findings, summary: { repositories, files, callSites: findings.length, high: findings.filter((finding) => finding.confidence === 'HIGH').length, medium: findings.filter((finding) => finding.confidence === 'MEDIUM').length, low: findings.filter((finding) => finding.confidence === 'LOW').length } };
  }
}
