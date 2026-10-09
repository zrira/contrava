import { pathsCompatible } from '@contrava/repo-scanner';
import type { Prisma } from '@prisma/client';
import type { OpenApiDocument } from '@contrava/shared';
import { operationsFromSpec, rebuildRepositoryImpacts } from '../impact/impact-matcher';

export async function rebuildUsageAssociations(transaction: Prisma.TransactionClient, repositoryId: string): Promise<void> {
  await transaction.apiUsage.deleteMany({ where: { repositoryId, apiId: { not: null } } });
  const [canonical, links] = await Promise.all([
    transaction.apiUsage.findMany({ where: { repositoryId, apiId: null } }),
    transaction.apiRepositoryLink.findMany({ where: { repositoryId }, include: { api: { include: { snapshots: { orderBy: { createdAt: 'desc' }, take: 1 } } } } }),
  ]);
  for (const link of links) {
    const snapshot = link.api.snapshots[0];
    if (!snapshot) continue;
    const operations = operationsFromSpec(snapshot.rawSpec as unknown as OpenApiDocument);
    for (const usage of canonical) {
      if (!operations.some((operation) => (!usage.httpMethod || operation.method === usage.httpMethod) && pathsCompatible(operation.path, usage.endpointPattern))) continue;
      await transaction.apiUsage.create({ data: {
        repositoryId, sourceFileId: usage.sourceFileId, apiId: link.apiId, httpMethod: usage.httpMethod,
        endpointPattern: usage.endpointPattern, line: usage.line, column: usage.column, snippet: usage.snippet,
        confidence: usage.confidence, matchType: usage.matchType, evidence: usage.evidence as Prisma.InputJsonValue,
      } });
    }
  }
  await rebuildRepositoryImpacts(transaction, repositoryId);
}
