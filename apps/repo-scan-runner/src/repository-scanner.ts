import { createHash } from 'node:crypto';
import { extname, posix } from 'node:path';
import { extractApiUsages, supportedExtensions } from '@contrava/repo-scanner';
import type { IndexedSourceFile, RepositoryScanClaim } from '@contrava/shared';
import { GitHubClient, GitHubError, type GitHubTreeEntry } from './github-client.js';

export interface RepositoryIndexResult {
  commitSha: string; defaultBranch: string; externalRepositoryId: string; fullScan: boolean;
  files: IndexedSourceFile[]; deletedPaths: string[]; indexedPaths: string[]; filesSkipped: number;
  metrics: { parseTimeMs: number; totalTimeMs: number; totalBytes: number };
}
const IGNORED_SEGMENTS = new Set(['node_modules', 'dist', 'build', 'coverage', '.next', '.git', 'generated', '__generated__']);
const IGNORED_FILES = /(?:^|\/)(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$|\.min\.(?:js|mjs|cjs)$|\.generated\.[jt]sx?$/i;

export function safeSourcePath(path: string): boolean {
  if (!path || path.includes('\0') || path.startsWith('/') || path.includes('\\')) return false;
  const normalized = posix.normalize(path);
  return normalized === path && !normalized.startsWith('../') && !path.split('/').some((part) => part === '..');
}
export function supportedSourcePath(path: string): boolean {
  return safeSourcePath(path) && supportedExtensions.has(extname(path).toLowerCase()) && !IGNORED_FILES.test(path) && !path.split('/').some((part) => IGNORED_SEGMENTS.has(part) || /^generated(?:[-_]|$)/i.test(part));
}
function language(path: string): string { const extension = extname(path).toLowerCase(); return extension === '.ts' || extension === '.tsx' ? 'TypeScript' : 'JavaScript'; }

export class RepositoryScanner {
  private readonly maxFiles = Number(process.env.REPO_MAX_FILES ?? 5_000);
  private readonly maxFileBytes = Number(process.env.REPO_MAX_FILE_BYTES ?? 524_288);
  private readonly maxTotalBytes = Number(process.env.REPO_MAX_TOTAL_BYTES ?? 52_428_800);
  private readonly concurrency = Number(process.env.REPO_SCAN_CONCURRENCY ?? 4);
  constructor(private readonly github: GitHubClient) {}

  async scan(claim: RepositoryScanClaim): Promise<RepositoryIndexResult> {
    const started = performance.now();
    const metadata = await this.github.repository(claim.owner, claim.name);
    const branch = claim.branch ?? metadata.default_branch;
    const commitSha = claim.commitSha ?? await this.github.resolveCommit(claim.owner, claim.name, branch);
    let fullScan = true; let entries: GitHubTreeEntry[] = []; let deletedPaths: string[] = [];
    if (claim.previousCommitSha && claim.previousCommitSha !== commitSha) {
      const changed = await this.github.compare(claim.owner, claim.name, claim.previousCommitSha, commitSha);
      if (changed) {
        fullScan = false;
        deletedPaths = changed.flatMap((file) => file.status === 'removed' ? [file.filename] : file.status === 'renamed' && file.previous_filename ? [file.previous_filename] : []);
        entries = changed.filter((file) => file.status !== 'removed').map((file) => ({ path: file.filename, type: 'blob', sha: file.sha, mode: '100644' }));
      }
    }
    if (fullScan) entries = await this.github.tree(claim.owner, claim.name, commitSha);
    if (entries.some((entry) => !safeSourcePath(entry.path))) throw new GitHubError('Repository contains an unsafe source path', 422, false);
    const relevant = entries.filter((entry) => entry.type === 'blob' && entry.mode !== '120000' && supportedSourcePath(entry.path));
    let skipped = entries.filter((entry) => entry.type === 'blob').length - relevant.length;
    if (relevant.length > this.maxFiles) throw new GitHubError(`Repository exceeds REPO_MAX_FILES (${this.maxFiles})`, 422, false);
    const declaredBytes = relevant.reduce((sum, entry) => sum + (entry.size ?? 0), 0);
    if (relevant.some((entry) => (entry.size ?? 0) > this.maxFileBytes)) throw new GitHubError(`Repository contains a file larger than REPO_MAX_FILE_BYTES (${this.maxFileBytes})`, 422, false);
    if (declaredBytes > this.maxTotalBytes) throw new GitHubError(`Repository exceeds REPO_MAX_TOTAL_BYTES (${this.maxTotalBytes})`, 422, false);

    const files: IndexedSourceFile[] = []; let totalBytes = 0; let parseTimeMs = 0; let cursor = 0;
    const workers = Array.from({ length: Math.max(1, Math.min(this.concurrency, relevant.length || 1)) }, async () => {
      while (cursor < relevant.length) {
        const entry = relevant[cursor++]!;
        const content = await this.github.blob(claim.owner, claim.name, entry.sha);
        totalBytes += content.length;
        if (content.length > this.maxFileBytes || totalBytes > this.maxTotalBytes) throw new GitHubError('Downloaded repository content exceeds configured hard limits', 422, false);
        if (content.includes(0)) { skipped += 1; continue; }
        const source = content.toString('utf8');
        if (source.includes('\uFFFD')) { skipped += 1; continue; }
        const parseStarted = performance.now();
        const usages = extractApiUsages(entry.path, source);
        parseTimeMs += performance.now() - parseStarted;
        files.push({ path: entry.path, language: language(entry.path), contentHash: createHash('sha256').update(content).digest('hex'), usages: usages.map((usage) => ({ ...usage, column: usage.column })) });
      }
    });
    await Promise.all(workers);
    files.sort((a, b) => a.path.localeCompare(b.path));
    return { commitSha, defaultBranch: metadata.default_branch, externalRepositoryId: String(metadata.id), fullScan, files, deletedPaths: deletedPaths.filter(safeSourcePath).sort(), indexedPaths: fullScan ? files.map((file) => file.path) : [], filesSkipped: skipped, metrics: { parseTimeMs: Math.round(parseTimeMs), totalTimeMs: Math.round(performance.now() - started), totalBytes } };
  }
}
