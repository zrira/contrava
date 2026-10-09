import express from 'express';
import { createServer } from 'node:http';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { ApiClient } from './client.js';
import { createExecutor } from './executor.js';
import { log } from './logger.js';
import { RabbitJobConsumer } from './rabbit-consumer.js';
import { JobRunner } from './runner.js';

const port = Number(process.env.SCAN_RUNNER_PORT ?? 3003);
const timeoutMs = Number(process.env.RUNNER_HTTP_TIMEOUT_MS ?? 8000);
const runnerId = process.env.RUNNER_ID ?? `${hostname()}-${randomUUID().slice(0, 8)}`;
const deliveryMode = process.env.JOB_DELIVERY_MODE ?? 'rabbitmq';
const maxConcurrentJobs = Number(process.env.MAX_CONCURRENT_JOBS ?? 2);
const heartbeatMs = Number(process.env.JOB_HEARTBEAT_MS ?? 10_000);
const api = new ApiClient(process.env.API_URL ?? 'http://localhost:3000', timeoutMs);
const execute = createExecutor(process.env.SPEC_WORKER_URL ?? 'http://localhost:3001', process.env.SCAN_WORKER_URL ?? 'http://localhost:3002', timeoutMs, Number(process.env.RUNNER_FAILURE_RATE ?? 0));
const pollingRunner = new JobRunner(api, execute, { runnerId, maxConcurrentJobs, pollIntervalMs: Number(process.env.JOB_POLL_INTERVAL_MS ?? 1000), heartbeatMs });
const rabbitConsumer = new RabbitJobConsumer(api, execute, { runnerId, rabbitUrl: process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672', prefetch: Number(process.env.RABBITMQ_PREFETCH ?? maxConcurrentJobs), heartbeatMs });

const app = express();
app.get('/health', (_request, response) => response.json({ status: deliveryMode === 'rabbitmq' && !rabbitConsumer.connected ? 'degraded' : 'ok', service: 'scan-runner', runnerId, deliveryMode, brokerConnected: rabbitConsumer.connected, activeJobs: deliveryMode === 'rabbitmq' ? rabbitConsumer.activeJobs : pollingRunner.activeJobs, maxConcurrentJobs }));
const server = createServer(app);
server.listen(port, () => {
  log('started', { runnerId, port, deliveryMode, maxConcurrentJobs });
  if (deliveryMode === 'postgres-polling') pollingRunner.start();
  else rabbitConsumer.start();
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  const graceMs = Number(process.env.RUNNER_SHUTDOWN_GRACE_MS ?? 15_000);
  log('shutdown started', { runnerId, signal, deliveryMode });
  if (deliveryMode === 'postgres-polling') await pollingRunner.stop(graceMs);
  else await rabbitConsumer.stop(graceMs);
  server.close((error) => {
    if (error) { console.error(error); process.exitCode = 1; }
    log('shutdown complete', { runnerId });
  });
}
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
