import { randomUUID } from 'node:crypto';
import { connect, type Channel, type ChannelModel, type GetMessage } from 'amqplib';
import { declareTopology, topologyFromEnv } from '@contrava/rabbitmq';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JobsService } from './jobs.service';
import { JobRepository } from './job.repository';
import { OutboxPublisherService } from '../outbox/outbox-publisher.service';
import { OutboxRepository } from '../outbox/outbox.repository';
import { RepositoriesService } from '../repositories/repositories.service';

const enabled = process.env.RABBITMQ_INTEGRATION === '1';
const suite = enabled ? describe : describe.skip;
const prisma = new PrismaClient();
let connection: ChannelModel;
let channel: Channel;
const topology = topologyFromEnv();
const rabbitUrl = process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672';

async function getEventually(queue: string, timeoutMs = 8_000): Promise<GetMessage> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await channel.get(queue, { noAck: false });
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${queue}`);
}

suite('RabbitMQ transactional outbox', () => {
  beforeAll(async () => {
    connection = await connect(rabbitUrl);
    channel = await connection.createChannel();
    await declareTopology(channel, topology);
    await Promise.all([topology.scanQueue, topology.repositoryScanQueue, topology.deadLetterQueue, topology.repositoryDeadLetterQueue, ...topology.retryQueues.map((retry) => retry.queue), ...topology.repositoryRetryQueues.map((retry) => retry.queue)].map((queue) => channel.purgeQueue(queue)));
    await prisma.$connect();
  });
  afterAll(async () => { await channel?.close(); await connection?.close(); await prisma.$disconnect(); });

  it('commits a job and outbox row atomically, then publishes with confirms', async () => {
    const api = await prisma.trackedApi.create({ data: { name: `rabbit-${randomUUID()}`, specUrl: 'https://example.com/openapi.json' } });
    const jobs = new JobsService(prisma as never, new JobRepository(prisma as never));
    const job = await jobs.enqueue(api.id, 'MANUAL', undefined, 'integration-request');
    await expect(prisma.outboxMessage.findFirstOrThrow({ where: { jobId: job.id } })).resolves.toMatchObject({ status: 'PENDING' });
    const publisher = new OutboxPublisherService(new OutboxRepository(prisma as never));
    await publisher.tick();
    await expect(prisma.outboxMessage.findFirstOrThrow({ where: { jobId: job.id } })).resolves.toMatchObject({ status: 'PUBLISHED' });
    const delivered = await getEventually(topology.scanQueue);
    expect(JSON.parse(delivered.content.toString())).toMatchObject({ version: 1, jobId: job.id, apiId: api.id, correlationId: 'integration-request' });
    channel.ack(delivered);
    await publisher.onModuleDestroy();
  });

  it('keeps an outbox row pending while the broker is unavailable and publishes after recovery', async () => {
    const api = await prisma.trackedApi.create({ data: { name: `recovery-${randomUUID()}`, specUrl: 'https://example.com/openapi.json' } });
    const jobs = new JobsService(prisma as never, new JobRepository(prisma as never));
    const job = await jobs.enqueue(api.id);
    const previous = process.env.RABBITMQ_URL;
    process.env.RABBITMQ_URL = 'amqp://127.0.0.1:1';
    const unavailable = new OutboxPublisherService(new OutboxRepository(prisma as never));
    await unavailable.tick();
    await expect(prisma.outboxMessage.findFirstOrThrow({ where: { jobId: job.id } })).resolves.toMatchObject({ status: 'PENDING' });
    await unavailable.onModuleDestroy();
    process.env.RABBITMQ_URL = previous ?? rabbitUrl;
    const recovered = new OutboxPublisherService(new OutboxRepository(prisma as never));
    await recovered.tick();
    await expect(prisma.outboxMessage.findFirstOrThrow({ where: { jobId: job.id } })).resolves.toMatchObject({ status: 'PUBLISHED' });
    channel.ack(await getEventually(topology.scanQueue));
    await recovered.onModuleDestroy();
  });

  it('publishes repository scan messages to the dedicated queue', async () => {
    const repository = await prisma.repository.create({ data: { owner: 'contrava-test', name: `repo-${randomUUID()}`, fullName: `contrava-test/repo-${randomUUID()}` } });
    const scan = await new RepositoriesService(prisma as never).enqueueScan(repository.id, 'repo-request');
    const publisher = new OutboxPublisherService(new OutboxRepository(prisma as never));
    await publisher.tick();
    const delivered = await getEventually(topology.repositoryScanQueue);
    expect(JSON.parse(delivered.content.toString())).toMatchObject({ version: 1, repositoryScanId: scan.id, repositoryId: repository.id });
    channel.ack(delivered); await publisher.onModuleDestroy();
  });

  it('routes delayed retries back to the execution queue and rejected poison messages to the DLQ', async () => {
    channel.publish(topology.retryExchange, 'scan.retry.5s', Buffer.from('{}'), { persistent: true });
    const retried = await getEventually(topology.scanQueue, 8_000);
    channel.reject(retried, false);
    const dead = await getEventually(topology.deadLetterQueue);
    expect(dead.fields.routingKey).toBe(topology.deadRoutingKey);
    channel.ack(dead);
  }, 12_000);
});
