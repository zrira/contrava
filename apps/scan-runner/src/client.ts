import type { ClaimedJob, CompleteJobRequest, JobDeliveryDisposition } from '@contrava/shared';
import { postJson } from './http-client.js';

export interface JobFailureResult { status: 'RETRY_SCHEDULED' | 'FAILED' | 'COMPLETED'; attempt: number; maxAttempts: number }

export interface RunnerApi {
  claim(runnerId: string, maxJobs: number, requestId: string): Promise<ClaimedJob[]>;
  start(job: ClaimedJob, requestId: string): Promise<void>;
  heartbeat(job: ClaimedJob, requestId: string): Promise<void>;
  complete(job: ClaimedJob, result: Omit<CompleteJobRequest, 'claimToken' | 'runnerId'>, requestId: string): Promise<void>;
  claimDelivery(jobId: string, runnerId: string, requestId: string): Promise<JobDeliveryDisposition>;
  markDeadLettered(jobId: string, requestId: string): Promise<void>;
  fail(job: ClaimedJob, error: string, requestId: string): Promise<JobFailureResult>;
}

export class ApiClient implements RunnerApi {
  constructor(private readonly baseUrl: string, private readonly timeoutMs: number) {}
  claim(runnerId: string, maxJobs: number, requestId: string) {
    return postJson<ClaimedJob[]>(`${this.baseUrl}/internal/jobs/claim`, { runnerId, maxJobs }, requestId, this.timeoutMs);
  }
  claimDelivery(jobId: string, runnerId: string, requestId: string) {
    return postJson<JobDeliveryDisposition>(`${this.baseUrl}/internal/jobs/${jobId}/claim`, { runnerId }, requestId, this.timeoutMs);
  }
  async markDeadLettered(jobId: string, requestId: string) {
    await postJson(`${this.baseUrl}/internal/jobs/${jobId}/dead-letter`, {}, requestId, this.timeoutMs);
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
  fail(job: ClaimedJob, error: string, requestId: string) {
    return postJson<JobFailureResult>(`${this.baseUrl}/internal/jobs/${job.id}/fail`, { claimToken: job.claimToken, runnerId: job.runnerId, error }, requestId, this.timeoutMs);
  }
}
