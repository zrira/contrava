export interface TrackedApi { id: string; name: string; specUrl: string; status: string; lastCheckedAt: string | null; createdAt: string; currentVersionHash: string | null; breakingChangesCount: number; scanEnabled: boolean; scanIntervalMinutes: number; nextScanAt: string | null; repositoryLinks?: Array<{ repository: { id: string; fullName: string; lastIndexedCommitSha: string | null } }> }
export interface Scan { id: string; apiId: string; status: string; startedAt: string; completedAt: string | null; error: string | null; api?: { id: string; name: string } }
export interface Change { id: string; currentSnapshotId: string; severity: 'NON_BREAKING' | 'POTENTIALLY_BREAKING' | 'BREAKING'; category: string; path: string; method: string | null; description: string; createdAt: string; _count?: { impactFindings: number } }
export interface Snapshot { id: string; apiId: string; contentHash: string; createdAt: string; currentChanges: Change[] }
export interface ScanJob { id: string; apiId: string; status: string; source: string; attempt: number; maxAttempts: number; scheduledFor: string; claimedAt: string | null; startedAt: string | null; completedAt: string | null; failedAt: string | null; lastError: string | null; createdAt: string; api?: { id: string; name: string } }
export interface PaginatedJobs { data: ScanJob[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } }
export interface QueueMetrics { pending: number; retrying: number; active: number; failed: number; expiredLeases: number; oldestPendingAgeSeconds: number | null; outboxPending: number; outboxFailed: number; messagesPublished: number; deadLettered: number }
export interface SystemHealth { status: 'ok' | 'degraded'; rabbitmq: { status: 'HEALTHY' | 'UNAVAILABLE' | 'DISABLED'; latencyMs?: number; dlqDepth: number | null; error?: string }; outbox: { pending: number; failed: number } }
export interface Repository { id: string; owner: string; name: string; fullName: string; status: string; defaultBranch: string | null; selectedBranch: string | null; headCommitSha: string | null; lastIndexedCommitSha: string | null; lastIndexedAt: string | null; _count: { sourceFiles: number; usages: number; apiLinks: number }; scans: RepositoryScan[]; apiLinks?: Array<{ api: { id: string; name: string } }> }
export interface RepositoryScan { id: string; status: string; commitSha: string | null; scannerVersion: string; filesScanned: number; filesSkipped: number; usagesFound: number; fullScan: boolean; error: string | null; createdAt: string; completedAt: string | null }
export interface ApiUsage { id: string; httpMethod: string | null; endpointPattern: string; line: number; snippet: string; confidence: string; matchType: string; sourceFile: { path: string; lastIndexedCommitSha: string } }
export interface ImpactFinding { id: string; path: string; line: number; confidence: string; reason: string; indexedCommitSha: string; repository: { id: string; fullName: string; headCommitSha: string | null; lastIndexedCommitSha: string | null }; apiUsage: { snippet: string; matchType: string; evidence: Record<string, string> } }
export interface ImpactResponse { findings: ImpactFinding[]; summary: { repositories: number; files: number; callSites: number; high: number; medium: number; low: number } }
export interface RepositoryMetrics { repositories: number; repositoryScansRunning: number; breakingChangesWithImpact: number; affectedRepositories: number; highConfidenceFindings: number }
export interface WorkerHealth { name: string; status: 'HEALTHY' | 'UNAVAILABLE'; latencyMs?: number; error?: string }

const baseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(payload?.message ?? `Request failed with HTTP ${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const listApis = () => apiRequest<TrackedApi[]>('/apis');
export const getApi = (id: string) => apiRequest<TrackedApi>(`/apis/${id}`);
export const createApi = (body: { name: string; specUrl: string }) => apiRequest<TrackedApi>('/apis', { method: 'POST', body: JSON.stringify(body) });
export const runScan = (id: string) => apiRequest<{ jobId: string; status: string }>(`/apis/${id}/scan`, { method: 'POST' });
export const updateSchedule = (id: string, body: { scanEnabled: boolean; scanIntervalMinutes: number }) => apiRequest<TrackedApi>(`/apis/${id}/schedule`, { method: 'PATCH', body: JSON.stringify(body) });
export const listJobs = (status?: string, page = 1, pageSize = 25) => { const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) }); if (status) query.set('status', status); return apiRequest<PaginatedJobs>(`/jobs?${query}`); };
export const getQueueMetrics = () => apiRequest<QueueMetrics>('/jobs/metrics');
export const getSystemHealth = () => apiRequest<SystemHealth>('/health');
export const listApiJobs = (id: string) => apiRequest<ScanJob[]>(`/apis/${id}/jobs`);
export const listScans = () => apiRequest<Scan[]>('/scans');
export const listChanges = (id: string) => apiRequest<Change[]>(`/apis/${id}/changes`);
export const listSnapshots = (id: string) => apiRequest<Snapshot[]>(`/apis/${id}/snapshots`);
export const listWorkers = () => apiRequest<WorkerHealth[]>('/workers');
export const listRepositories = () => apiRequest<Repository[]>('/repositories');
export const getRepository = (id: string) => apiRequest<Repository>(`/repositories/${id}`);
export const createRepository = (body: { owner: string; name: string; selectedBranch?: string }) => apiRequest<Repository>('/repositories', { method: 'POST', body: JSON.stringify(body) });
export const scanRepository = (id: string) => apiRequest<RepositoryScan>(`/repositories/${id}/scan`, { method: 'POST', body: '{}' });
export const listRepositoryUsages = (id: string, page = 1) => apiRequest<{ data: ApiUsage[]; pagination: { page: number; totalPages: number; total: number } }>(`/repositories/${id}/usages?page=${page}`);
export const linkRepository = (apiId: string, repositoryId: string) => apiRequest(`/apis/${apiId}/repositories/${repositoryId}`, { method: 'POST', body: '{}' });
export const unlinkRepository = (apiId: string, repositoryId: string) => apiRequest(`/apis/${apiId}/repositories/${repositoryId}`, { method: 'DELETE' });
export const getImpact = (apiId: string, changeId: string) => apiRequest<ImpactResponse>(`/apis/${apiId}/changes/${changeId}/impact`);
export const getRepositoryMetrics = () => apiRequest<RepositoryMetrics>('/repositories/metrics');
