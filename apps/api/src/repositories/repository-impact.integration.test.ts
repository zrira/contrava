import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient, type ChangeSeverity } from '@prisma/client';
import { RepositoriesService } from './repositories.service';
import { createFindingsForChange } from '../impact/impact-matcher';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL is required');
const prisma = new PrismaClient({ datasources: { db: { url } } });
const service = new RepositoriesService(prisma as never);
const commitA = 'a'.repeat(40); const commitB = 'b'.repeat(40);

beforeAll(() => prisma.$connect());
beforeEach(async () => { await prisma.trackedApi.deleteMany(); await prisma.repository.deleteMany(); });
afterAll(() => prisma.$disconnect());

async function impactFixture(category: string, description = 'changed') {
  const api = await prisma.trackedApi.create({ data: { name: `API ${category}`, specUrl: 'https://example.test/openapi.json' } });
  const repository = await prisma.repository.create({ data: { owner: 'owner', name: `repo-${category.toLowerCase()}`, fullName: `owner/repo-${category.toLowerCase()}`, lastIndexedCommitSha: commitA } });
  await prisma.apiRepositoryLink.create({ data: { apiId: api.id, repositoryId: repository.id } });
  const file = await prisma.sourceFile.create({ data: { repositoryId: repository.id, path: 'src/users.ts', language: 'TypeScript', contentHash: '1'.repeat(64), lastIndexedCommitSha: commitA } });
  const usage = await prisma.apiUsage.create({ data: { repositoryId: repository.id, sourceFileId: file.id, apiId: api.id, httpMethod: 'GET', endpointPattern: '/users/{param}', line: 42, column: 3, snippet: 'axios.get(`/users/${id}`)', confidence: 'HIGH', matchType: 'HTTP_CLIENT_CALL', evidence: { call: 'axios.get' } } });
  const previous = await prisma.apiSnapshot.create({ data: { apiId: api.id, contentHash: '2'.repeat(64), rawSpec: { openapi: '3.1.0' } } });
  const current = await prisma.apiSnapshot.create({ data: { apiId: api.id, contentHash: '3'.repeat(64), rawSpec: { openapi: '3.1.0' } } });
  const change = await prisma.apiChange.create({ data: { apiId: api.id, previousSnapshotId: previous.id, currentSnapshotId: current.id, severity: 'BREAKING' as ChangeSeverity, category: category as never, path: '/users/{id}', method: 'GET', description } });
  return { api, repository, usage, change };
}

describe('deterministic impact analysis', () => {
  it('creates a HIGH finding for an exact removed endpoint usage', async () => {
    const fixture = await impactFixture('ENDPOINT_REMOVED');
    await prisma.$transaction((transaction) => createFindingsForChange(transaction, fixture.change));
    await expect(prisma.impactFinding.findFirstOrThrow()).resolves.toMatchObject({ confidence: 'HIGH', path: 'src/users.ts', line: 42, indexedCommitSha: commitA });
  });
  it.each(['RESPONSE_PROPERTY_REMOVED', 'REQUEST_PROPERTY_ADDED', 'REQUEST_TYPE_CHANGED', 'RESPONSE_TYPE_CHANGED'])('uses explainable MEDIUM confidence for %s', async (category) => {
    const fixture = await impactFixture(category);
    await prisma.$transaction((transaction) => createFindingsForChange(transaction, fixture.change));
    const finding = await prisma.impactFinding.findFirstOrThrow();
    expect(finding.confidence).toBe('MEDIUM');
    expect(finding.reason).toMatch(/not proven|not traced|cannot prove/);
  });
});

describe('incremental repository persistence', () => {
  it('keeps unchanged files, replaces changed usages, removes deleted files, and adds new files', async () => {
    const repository = await prisma.repository.create({ data: { owner: 'owner', name: 'incremental', fullName: 'owner/incremental', lastIndexedCommitSha: commitA } });
    await prisma.sourceFile.createMany({ data: [
      { repositoryId: repository.id, path: 'src/unchanged.ts', language: 'TypeScript', contentHash: '1'.repeat(64), lastIndexedCommitSha: commitA },
      { repositoryId: repository.id, path: 'src/changed.ts', language: 'TypeScript', contentHash: '2'.repeat(64), lastIndexedCommitSha: commitA },
      { repositoryId: repository.id, path: 'src/deleted.ts', language: 'TypeScript', contentHash: '3'.repeat(64), lastIndexedCommitSha: commitA },
    ] });
    const scan = await service.enqueueScan(repository.id, 'incremental-test');
    const disposition = await service.claim(scan.id, 'runner');
    if (disposition.disposition !== 'CLAIMED') throw new Error('Expected claim');
    await service.resolve(scan.id, disposition.scan.claimToken, 'runner', { commitSha: commitB, defaultBranch: 'main', externalRepositoryId: '1' });
    const usage = { httpMethod: 'GET', endpointPattern: '/users/{param}', line: 1, column: 1, snippet: "fetch('/users/1')", confidence: 'HIGH' as const, matchType: 'STATIC_LITERAL' as const, evidence: { call: 'fetch' } };
    await service.complete(scan.id, { claimToken: disposition.scan.claimToken, runnerId: 'runner', commitSha: commitB, defaultBranch: 'main', externalRepositoryId: '1', fullScan: false, deletedPaths: ['src/deleted.ts'], indexedPaths: [], filesSkipped: 0, files: [
      { path: 'src/changed.ts', language: 'TypeScript', contentHash: '4'.repeat(64), usages: [usage] },
      { path: 'src/new.ts', language: 'TypeScript', contentHash: '5'.repeat(64), usages: [usage] },
    ] });
    const files = await prisma.sourceFile.findMany({ where: { repositoryId: repository.id }, orderBy: { path: 'asc' } });
    expect(files.map((file) => file.path)).toEqual(['src/changed.ts', 'src/new.ts', 'src/unchanged.ts']);
    expect(files.find((file) => file.path === 'src/unchanged.ts')?.lastIndexedCommitSha).toBe(commitA);
    expect(await prisma.apiUsage.count({ where: { repositoryId: repository.id, apiId: null } })).toBe(2);
  });
  it('coalesces concurrent manual scan requests for one repository', async () => {
    const repository = await prisma.repository.create({ data: { owner: 'owner', name: 'coalesce', fullName: 'owner/coalesce' } });
    const scans = await Promise.all(Array.from({ length: 5 }, (_, index) => service.enqueueScan(repository.id, `request-${index}`)));
    expect(new Set(scans.map((scan) => scan.id)).size).toBe(1);
  });
});
