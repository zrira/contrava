import { randomUUID } from 'node:crypto';
import type { ClaimedJob } from '@contrava/shared';

const args = new Map(process.argv.slice(2).map((argument) => {
  const [key, value = 'true'] = argument.replace(/^--/, '').split('=', 2);
  return [key, value];
}));
const jobsRequested = Number(args.get('jobs') ?? 100);
const runnerCount = Number(args.get('runners') ?? 4);
const batchSize = Number(args.get('batch') ?? 10);
const apiUrl = args.get('api-url') ?? process.env.API_URL ?? 'http://localhost:3000';

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
    headers: { 'content-type': 'application/json', 'x-request-id': randomUUID() },
  });
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}: ${await response.text()}`);
  return response.json() as Promise<T>;
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]!;
}

const existingApiId = args.get('api-id');
const apiId = existingApiId ?? (await request<{ id: string }>('/apis', {
  name: `Load test ${new Date().toISOString()}`,
  specUrl: 'https://example.invalid/load-test-openapi.json',
})).id;

console.log(`Enqueuing ${jobsRequested} jobs for API ${apiId}`);
for (let offset = 0; offset < jobsRequested; offset += 25) {
  await Promise.all(Array.from({ length: Math.min(25, jobsRequested - offset) }, () => request(`/apis/${apiId}/scan`, {})));
}

const claimLatencies: number[] = [];
const executionLatencies: number[] = [];
let processed = 0;
const started = performance.now();

async function runSyntheticWorker(index: number): Promise<void> {
  const runnerId = `load-runner-${index}-${randomUUID().slice(0, 8)}`;
  while (true) {
    const claimStarted = performance.now();
    const jobs = await request<ClaimedJob[]>('/internal/jobs/claim', { runnerId, maxJobs: batchSize });
    claimLatencies.push(performance.now() - claimStarted);
    if (jobs.length === 0) return;
    await Promise.all(jobs.map(async (job) => {
      const executionStarted = performance.now();
      await request(`/internal/jobs/${job.id}/start`, { claimToken: job.claimToken, runnerId });
      await request(`/internal/jobs/${job.id}/complete`, {
        claimToken: job.claimToken,
        runnerId,
        hash: '0'.repeat(64),
        spec: { openapi: '3.1.0', info: { title: 'Synthetic load', version: '1' }, paths: {} },
        previousSnapshotId: job.previousSnapshot?.id ?? null,
        changes: [],
      });
      executionLatencies.push(performance.now() - executionStarted);
      processed += 1;
    }));
  }
}

await Promise.all(Array.from({ length: runnerCount }, (_, index) => runSyntheticWorker(index + 1)));
const totalMs = performance.now() - started;
const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
console.log(JSON.stringify({
  jobsRequested,
  jobsProcessed: processed,
  runners: runnerCount,
  batchSize,
  totalMs: Math.round(totalMs),
  jobsPerSecond: Number((processed / (totalMs / 1000)).toFixed(2)),
  averageClaimLatencyMs: Number(average(claimLatencies).toFixed(2)),
  averageExecutionLatencyMs: Number(average(executionLatencies).toFixed(2)),
  p95ExecutionLatencyMs: Number(percentile(executionLatencies, 0.95).toFixed(2)),
}, null, 2));
