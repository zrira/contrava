import type { ClaimedJob, CompleteJobRequest } from '@contrava/shared';
import { postJson } from './http-client.js';

export interface RunnerApi {
  claim(runnerId: string, maxJobs: number, requestId: string): Promise<ClaimedJob[]>;
  start(job: ClaimedJob, requestId: string): Promise<void>;
  heartbeat(job: ClaimedJob, requestId: string): Promise<void>;
  complete(job: ClaimedJob, result: Omit<CompleteJobRequest, 'claimToken' | 'runnerId'>, requestId: string): Promise<void>;
  fail(job: ClaimedJob, error: string, requestId: string): Promise<void>;
}

export class ApiClient implements RunnerApi {
  constructor(private readonly baseUrl: string, private readonly timeoutMs: number) {}
  claim(runnerId: string, maxJobs: number, requestId: string) {
    return postJson<ClaimedJob[]>(`${this.baseUrl}/internal/jobs/claim`, { runnerId, maxJobs }, requestId, this.timeoutMs);
  }
  async start(job: ClaimedJob, requestId: string) {
    await postJson(`${this.baseUrl}/internal/jobs/${job.id}/start`, { claimToken: job.claimToken, runnerId: job.runnerId }, requestId, this.timeoutMs);
  }
  async heartbeat(job: ClaimedJob, requestId: string) {
    await postJson(`${this.baseUrl}/internal/jobs/${job.id}/heartbeat`, { claimToken: job.claimToken, runnerId: job.runnerId }, requestId, this.timeoutMs);
  }
  async complete(job: ClaimedJob, result: Omit<CompleteJobRequest, 'claimToken' | 'runnerId'>, requestId: string) {
    await postJson(`${this.baseUrl}/internal/jobs/${job.id}/complete`, { claimToken: job.claimToken, runnerId: job.runnerId, ...result }, requestId, this.timeoutMs);
  }
  async fail(job: ClaimedJob, error: string, requestId: string) {
    await postJson(`${this.baseUrl}/internal/jobs/${job.id}/fail`, { claimToken: job.claimToken, runnerId: job.runnerId, error }, requestId, this.timeoutMs);
  }
}
