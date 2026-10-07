export interface TrackedApi { id: string; name: string; specUrl: string; status: string; lastCheckedAt: string | null; createdAt: string; currentVersionHash: string | null; breakingChangesCount: number }
export interface Scan { id: string; apiId: string; status: string; startedAt: string; completedAt: string | null; error: string | null; api?: { id: string; name: string } }
export interface Change { id: string; currentSnapshotId: string; severity: 'NON_BREAKING' | 'POTENTIALLY_BREAKING' | 'BREAKING'; category: string; path: string; method: string | null; description: string; createdAt: string }
export interface Snapshot { id: string; apiId: string; contentHash: string; createdAt: string; currentChanges: Change[] }
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
export const runScan = (id: string) => apiRequest<Scan>(`/apis/${id}/scan`, { method: 'POST' });
export const listScans = () => apiRequest<Scan[]>('/scans');
export const listChanges = (id: string) => apiRequest<Change[]>(`/apis/${id}/changes`);
export const listSnapshots = (id: string) => apiRequest<Snapshot[]>(`/apis/${id}/snapshots`);
export const listWorkers = () => apiRequest<WorkerHealth[]>('/workers');
