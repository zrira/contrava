import express from 'express';
import { createServer } from 'node:http';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { ApiClient } from './client.js';
import { createExecutor } from './executor.js';
import { log } from './logger.js';
import { JobRunner } from './runner.js';

const port = Number(process.env.SCAN_RUNNER_PORT ?? 3003);
const timeoutMs = Number(process.env.RUNNER_HTTP_TIMEOUT_MS ?? 8000);
const runnerId = process.env.RUNNER_ID ?? `${hostname()}-${randomUUID().slice(0, 8)}`;
const options = {
  runnerId,
  maxConcurrentJobs: Number(process.env.MAX_CONCURRENT_JOBS ?? 2),
  pollIntervalMs: Number(process.env.JOB_POLL_INTERVAL_MS ?? 1000),
  heartbeatMs: Number(process.env.JOB_HEARTBEAT_MS ?? 10_000),
};
const api = new ApiClient(process.env.API_URL ?? 'http://localhost:3000', timeoutMs);
const execute = createExecutor(process.env.SPEC_WORKER_URL ?? 'http://localhost:3001', process.env.SCAN_WORKER_URL ?? 'http://localhost:3002', timeoutMs, Number(process.env.RUNNER_FAILURE_RATE ?? 0));
const runner = new JobRunner(api, execute, options);

const app = express();
app.get('/health', (_request, response) => response.json({ status: 'ok', service: 'scan-runner', runnerId, activeJobs: runner.activeJobs, maxConcurrentJobs: options.maxConcurrentJobs }));
const server = createServer(app);
server.listen(port, () => { log('started', { runnerId, port, maxConcurrentJobs: options.maxConcurrentJobs }); runner.start(); });

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log('shutdown started', { runnerId, signal, activeJobs: runner.activeJobs });
  await runner.stop(Number(process.env.RUNNER_SHUTDOWN_GRACE_MS ?? 15_000));
  server.close((error) => {
    if (error) { console.error(error); process.exitCode = 1; }
    log('shutdown complete', { runnerId, activeJobs: runner.activeJobs });
  });
}
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
