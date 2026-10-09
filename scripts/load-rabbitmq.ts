import { randomUUID } from 'node:crypto';
import { connect, type Channel, type ConsumeMessage } from 'amqplib';
import { declareTopology, topologyFromEnv } from '@contrava/rabbitmq';
import type { JobDeliveryDisposition, ScanExecuteMessage } from '@contrava/shared';

const args = new Map(process.argv.slice(2).map((argument) => {
  const [key, value = 'true'] = argument.replace(/^--/, '').split('=', 2);
  return [key, value];
}));
const jobsRequested = Number(args.get('jobs') ?? 1_000);
const runnerCount = Number(args.get('runners') ?? 4);
const apiCount = Number(args.get('apis') ?? 10);
const prefetch = Number(args.get('prefetch') ?? 10);
const apiUrl = args.get('api-url') ?? process.env.API_URL ?? 'http://localhost:3000';
const rabbitUrl = process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672';
const topology = topologyFromEnv();

async function request<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', 'x-request-id': randomUUID() } });
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}: ${await response.text()}`);
  return response.json() as Promise<T>;
}
function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

async function main(): Promise<void> {
  const connection = await connect(rabbitUrl);
  const channels: Channel[] = [];
  const deliveryLatencies: number[] = [];
  const executionLatencies: number[] = [];
  const completed = new Set<string>();
  let finish!: () => void;
  const done = new Promise<void>((resolve) => { finish = resolve; });
  const started = performance.now();

  async function handle(channel: Channel, runnerId: string, message: ConsumeMessage): Promise<void> {
    const payload = JSON.parse(message.content.toString()) as ScanExecuteMessage;
    try {
      deliveryLatencies.push(Date.now() - new Date(payload.createdAt).getTime());
      const claim = await request<JobDeliveryDisposition>(`/internal/jobs/${payload.jobId}/claim`, { runnerId });
      if (claim.disposition === 'CLAIMED') {
        const executionStarted = performance.now();
        await request(`/internal/jobs/${payload.jobId}/start`, { claimToken: claim.job.claimToken, runnerId });
        await request(`/internal/jobs/${payload.jobId}/complete`, { claimToken: claim.job.claimToken, runnerId, hash: '0'.repeat(64), spec: { openapi: '3.1.0', info: { title: 'Rabbit load', version: '1' }, paths: {} }, previousSnapshotId: claim.job.previousSnapshot?.id ?? null, changes: [] });
        executionLatencies.push(performance.now() - executionStarted);
      }
      channel.ack(message);
      if ((claim.disposition === 'CLAIMED' || claim.disposition === 'COMPLETED') && !completed.has(payload.jobId)) completed.add(payload.jobId);
      if (completed.size >= jobsRequested) finish();
    } catch (error) {
      channel.nack(message, false, true);
      console.error(error instanceof Error ? error.message : error);
    }
  }

  for (let index = 0; index < runnerCount; index += 1) {
    const channel = await connection.createChannel();
    await declareTopology(channel, topology);
    await channel.prefetch(prefetch);
    const runnerId = `rabbit-load-${index + 1}-${randomUUID().slice(0, 8)}`;
    await channel.consume(topology.scanQueue, (message) => { if (message) void handle(channel, runnerId, message); }, { noAck: false });
    channels.push(channel);
  }

  const apis = await Promise.all(Array.from({ length: apiCount }, (_, index) => request<{ id: string }>('/apis', { name: `Rabbit load ${index + 1} ${randomUUID().slice(0, 8)}`, specUrl: 'https://example.invalid/load.json' })));
  for (let offset = 0; offset < jobsRequested; offset += 25) {
    await Promise.all(Array.from({ length: Math.min(25, jobsRequested - offset) }, (_, index) => request(`/apis/${apis[(offset + index) % apis.length]!.id}/scan`, {})));
  }
  let timeout: NodeJS.Timeout;
  const timedOut = new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Load test timed out')), 120_000); });
  await Promise.race([done, timedOut]);
  clearTimeout(timeout!);
  const totalMs = performance.now() - started;
  const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  console.log(JSON.stringify({ jobsRequested, jobsProcessed: completed.size, runners: runnerCount, apis: apiCount, prefetch, totalMs: Math.round(totalMs), jobsPerSecond: Number((completed.size / (totalMs / 1000)).toFixed(2)), averageDeliveryLatencyMs: Number(average(deliveryLatencies).toFixed(2)), p95DeliveryLatencyMs: Number(percentile(deliveryLatencies, 0.95).toFixed(2)), averageExecutionLatencyMs: Number(average(executionLatencies).toFixed(2)), p95ExecutionLatencyMs: Number(percentile(executionLatencies, 0.95).toFixed(2)) }, null, 2));
  await Promise.all(channels.map((channel) => channel.close()));
  await connection.close();
}
void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
