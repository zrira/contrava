import type { ClaimedJob, CompleteJobRequest, DiffResponse, FetchSpecResponse } from '@contrava/shared';
import { postJson } from './http-client.js';

export type JobResult = Omit<CompleteJobRequest, 'claimToken'>;
export type JobExecutor = (job: ClaimedJob, requestId: string) => Promise<JobResult>;

export function createExecutor(specWorkerUrl: string, scanWorkerUrl: string, timeoutMs: number, failureRate: number): JobExecutor {
  return async (job, requestId) => {
    if (failureRate > 0 && Math.random() < failureRate) throw new Error('Simulated runner failure');
    const fetched = await postJson<FetchSpecResponse>(`${specWorkerUrl}/fetch-spec`, { apiId: job.apiId, specUrl: job.specUrl }, requestId, timeoutMs);
    const unchanged = job.previousSnapshot?.contentHash === fetched.hash;
    const changes = !job.previousSnapshot || unchanged
      ? []
      : (await postJson<DiffResponse>(`${scanWorkerUrl}/diff`, { previous: job.previousSnapshot.spec, current: fetched.spec }, requestId, timeoutMs)).changes;
    return { hash: fetched.hash, spec: fetched.spec, previousSnapshotId: job.previousSnapshot?.id ?? null, changes };
  };
}
