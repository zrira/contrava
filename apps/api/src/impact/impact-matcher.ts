import { pathsCompatible } from '@contrava/repo-scanner';
import type { ApiChange, Prisma } from '@prisma/client';
import type { OpenApiDocument } from '@contrava/shared';

export const IMPACT_ALGORITHM_VERSION = '1';
const METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']);

export function operationsFromSpec(spec: OpenApiDocument): Array<{ method: string; path: string }> {
  if (!spec.paths || typeof spec.paths !== 'object') return [];
  const operations: Array<{ method: string; path: string }> = [];
  for (const [path, value] of Object.entries(spec.paths)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    for (const method of Object.keys(value)) if (METHODS.has(method.toLowerCase())) operations.push({ method: method.toUpperCase(), path });
  }
  return operations.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

function findingRule(change: Pick<ApiChange, 'category' | 'method' | 'path'>, usageConfidence: 'HIGH' | 'MEDIUM' | 'LOW') {
  const endpointRemoval = change.category === 'ENDPOINT_REMOVED' || change.category === 'METHOD_REMOVED';
  if (endpointRemoval) return {
    confidence: usageConfidence,
    reason: `Exact normalized ${change.method ?? 'endpoint'} ${change.path} usage matches a removed ${change.category === 'METHOD_REMOVED' ? 'method' : 'endpoint'}.`,
  } as const;
  const response = change.category.startsWith('RESPONSE_') || change.category === 'SUCCESS_RESPONSE_REMOVED';
  const request = change.category.startsWith('REQUEST_') || change.category === 'REQUIRED_PARAMETER_ADDED' || change.category === 'FIELD_BECAME_REQUIRED' || change.category === 'PARAMETER_CONSTRAINTS_TIGHTENED';
  return {
    confidence: usageConfidence === 'LOW' ? 'LOW' as const : 'MEDIUM' as const,
    reason: response
      ? `Endpoint usage matches ${change.method ?? 'the changed operation'} ${change.path}; the response change may affect this call site, but field-level data flow is not proven.`
      : request
        ? `Endpoint usage matches ${change.method ?? 'the changed operation'} ${change.path}; request construction may require an update, but payload fields are not traced in Phase 5.`
        : `Endpoint usage matches ${change.method ?? 'the changed operation'} ${change.path}; deterministic analysis cannot prove the exact value-level effect.`,
  };
}

export async function createFindingsForChange(transaction: Prisma.TransactionClient, change: ApiChange): Promise<number> {
  if (change.severity === 'NON_BREAKING') return 0;
  const usages = await transaction.apiUsage.findMany({
    where: { apiId: change.apiId, ...(change.method ? { OR: [{ httpMethod: change.method.toUpperCase() }, { httpMethod: null }] } : {}) },
    include: { sourceFile: { select: { path: true, lastIndexedCommitSha: true } } },
  });
  let created = 0;
  for (const usage of usages) {
    if (!pathsCompatible(usage.endpointPattern, change.path)) continue;
    const rule = findingRule(change, usage.confidence);
    await transaction.impactFinding.upsert({
      where: { apiChangeId_apiUsageId_impactAlgorithmVersion: { apiChangeId: change.id, apiUsageId: usage.id, impactAlgorithmVersion: IMPACT_ALGORITHM_VERSION } },
      create: { apiChangeId: change.id, repositoryId: usage.repositoryId, apiUsageId: usage.id, path: usage.sourceFile.path, line: usage.line, confidence: rule.confidence, reason: rule.reason, indexedCommitSha: usage.sourceFile.lastIndexedCommitSha, impactAlgorithmVersion: IMPACT_ALGORITHM_VERSION },
      update: { confidence: rule.confidence, reason: rule.reason, indexedCommitSha: usage.sourceFile.lastIndexedCommitSha },
    });
    created += 1;
  }
  return created;
}

export async function rebuildRepositoryImpacts(transaction: Prisma.TransactionClient, repositoryId: string): Promise<void> {
  await transaction.impactFinding.deleteMany({ where: { repositoryId } });
  const changes = await transaction.apiChange.findMany({ where: { severity: { in: ['BREAKING', 'POTENTIALLY_BREAKING'] }, api: { repositoryLinks: { some: { repositoryId } } } } });
  for (const change of changes) await createFindingsForChange(transaction, change);
}
