import express from 'express';
import { createServer } from 'node:http';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { RepositoryApiClient } from './api-client.js';
import { GitHubClient } from './github-client.js';
import { log } from './logger.js';
import { RepositoryScanConsumer } from './rabbit-consumer.js';
import { RepositoryScanner } from './repository-scanner.js';

const port = Number(process.env.REPO_SCAN_RUNNER_PORT ?? 3004);
const runnerId = process.env.REPO_SCAN_RUNNER_ID ?? `${hostname()}-repo-${randomUUID().slice(0, 8)}`;
const github = new GitHubClient();
const consumer = new RepositoryScanConsumer(
  new RepositoryApiClient(process.env.API_URL ?? 'http://localhost:3000', Number(process.env.REPO_RUNNER_HTTP_TIMEOUT_MS ?? 10_000)),
  github, new RepositoryScanner(github),
  { runnerId, rabbitUrl: process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672', prefetch: Number(process.env.REPO_SCAN_PREFETCH ?? 1), heartbeatMs: Number(process.env.REPO_SCAN_HEARTBEAT_MS ?? 15_000) },
);
const app = express();
app.get('/health', (_request, response) => response.json({ status: consumer.connected ? 'ok' : 'degraded', service: 'repo-scan-runner', runnerId, brokerConnected: consumer.connected, activeScans: consumer.activeScans, maxConcurrency: Number(process.env.REPO_SCAN_PREFETCH ?? 1), github: { authMode: github.authMode, rateLimit: github.lastRateLimit } }));
const server = createServer(app);
server.listen(port, () => { log('started', { runnerId, port, authMode: github.authMode }); consumer.start(); });
let stopping = false;
async function shutdown(signal: string) { if (stopping) return; stopping = true; log('shutdown started', { signal, runnerId }); await consumer.stop(Number(process.env.REPO_SCAN_SHUTDOWN_GRACE_MS ?? 30_000)); server.close(); }
process.once('SIGINT', () => void shutdown('SIGINT')); process.once('SIGTERM', () => void shutdown('SIGTERM'));
