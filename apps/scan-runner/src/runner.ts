import { randomUUID } from 'node:crypto';
import type { ClaimedJob } from '@contrava/shared';
import type { RunnerApi } from './client.js';
import type { JobExecutor } from './executor.js';
import { log } from './logger.js';

export interface RunnerOptions {
  runnerId: string;
  maxConcurrentJobs: number;
  pollIntervalMs: number;
  heartbeatMs: number;
}

export class JobRunner {
  private readonly active = new Map<string, Promise<void>>();
  private pollTimer?: NodeJS.Timeout;
  private accepting = false;
  private polling = false;

  constructor(private readonly api: RunnerApi, private readonly execute: JobExecutor, readonly options: RunnerOptions) {}

  get activeJobs(): number { return this.active.size; }

  start(): void {
    this.accepting = true;
    this.pollTimer = setInterval(() => void this.pollOnce(), this.options.pollIntervalMs);
    this.pollTimer.unref();
    void this.pollOnce();
  }

  async pollOnce(): Promise<void> {
    if (!this.accepting || this.polling) return;
    this.polling = true;
    try {
      while (this.accepting && this.active.size < this.options.maxConcurrentJobs) {
        const requestId = randomUUID();
        const job = await this.api.claim(this.options.runnerId, requestId);
        if (!job) break;
        const task = this.runJob(job, requestId).finally(() => this.active.delete(job.id));
        this.active.set(job.id, task);
      }
    } catch (error) {
      log('poll failed', { runnerId: this.options.runnerId, error: error instanceof Error ? error.message : 'Unknown error' });
    } finally { this.polling = false; }
  }

  private async runJob(job: ClaimedJob, requestId: string): Promise<void> {
    const fields = { jobId: job.id, apiId: job.apiId, attempt: job.attempt, runnerId: this.options.runnerId, requestId };
    log('job claimed', fields);
    let heartbeat: NodeJS.Timeout | undefined;
    try {
      await this.api.start(job, requestId);
      heartbeat = setInterval(() => {
        void this.api.heartbeat(job, requestId).catch((error: unknown) => log('heartbeat failed', { ...fields, error: error instanceof Error ? error.message : 'Unknown error' }));
      }, this.options.heartbeatMs);
      heartbeat.unref();
      const result = await this.execute(job, requestId);
      await this.api.complete(job, result, requestId);
      log('job completed', fields);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown job error';
      log('job failed', { ...fields, error: message });
      try { await this.api.fail(job, message, requestId); }
      catch (failError) { log('failure report failed', { ...fields, error: failError instanceof Error ? failError.message : 'Unknown error' }); }
    } finally { if (heartbeat) clearInterval(heartbeat); }
  }

  async stop(graceMs: number): Promise<void> {
    this.accepting = false;
    if (this.pollTimer) clearInterval(this.pollTimer);
    const settled = Promise.allSettled([...this.active.values()]);
    await Promise.race([settled, new Promise<void>((resolve) => setTimeout(resolve, graceMs))]);
  }
}
