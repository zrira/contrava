import type { CompleteRepositoryScanRequest, RepositoryScanDisposition } from '@contrava/shared';

async function post<T>(baseUrl: string, path: string, body: unknown, requestId: string, timeoutMs: number): Promise<T> {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}${path}`, { method: 'POST', signal: controller.signal, headers: { 'content-type': 'application/json', 'x-request-id': requestId }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
    return await response.json() as T;
  } finally { clearTimeout(timer); }
}

export class RepositoryApiClient {
  constructor(private readonly baseUrl: string, private readonly timeoutMs: number) {}
  claim(scanId: string, runnerId: string, requestId: string) { return post<RepositoryScanDisposition>(this.baseUrl, `/internal/repository-scans/${scanId}/claim`, { runnerId }, requestId, this.timeoutMs); }
  resolve(scanId: string, claimToken: string, runnerId: string, metadata: { commitSha: string; defaultBranch: string; externalRepositoryId: string }, requestId: string) { return post<{ alreadyIndexed: boolean }>(this.baseUrl, `/internal/repository-scans/${scanId}/resolve`, { claimToken, runnerId, ...metadata }, requestId, this.timeoutMs); }
  heartbeat(scanId: string, claimToken: string, runnerId: string, requestId: string) { return post(this.baseUrl, `/internal/repository-scans/${scanId}/heartbeat`, { claimToken, runnerId }, requestId, this.timeoutMs); }
  complete(scanId: string, body: CompleteRepositoryScanRequest, requestId: string) { return post(this.baseUrl, `/internal/repository-scans/${scanId}/complete`, body, requestId, this.timeoutMs); }
  fail(scanId: string, body: { claimToken: string; runnerId: string; error: string; retryable: boolean; rateLimited?: boolean; retryAt?: string }, requestId: string) { return post<{ status: string }>(this.baseUrl, `/internal/repository-scans/${scanId}/fail`, body, requestId, this.timeoutMs); }
}
