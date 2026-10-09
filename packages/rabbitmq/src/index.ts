import type { Channel } from 'amqplib';

export interface RabbitTopology {
  jobsExchange: string;
  retryExchange: string;
  scanQueue: string;
  repositoryScanQueue: string;
  deadLetterExchange: string;
  deadLetterQueue: string;
  repositoryDeadLetterQueue: string;
  scanRoutingKey: string;
  repositoryScanRoutingKey: string;
  deadRoutingKey: string;
  repositoryDeadRoutingKey: string;
  retryQueues: Array<{ queue: string; routingKey: string; ttlMs: number }>;
  repositoryRetryQueues: Array<{ queue: string; routingKey: string; ttlMs: number }>;
}

export function topologyFromEnv(environment: NodeJS.ProcessEnv = process.env): RabbitTopology {
  const prefix = environment.RABBITMQ_TOPOLOGY_PREFIX?.trim();
  const name = (base: string) => prefix ? `${prefix}.${base}` : base;
  return {
    jobsExchange: environment.RABBITMQ_EXCHANGE ?? name('contrava.jobs'),
    retryExchange: environment.RABBITMQ_RETRY_EXCHANGE ?? name('contrava.retry'),
    scanQueue: environment.RABBITMQ_SCAN_QUEUE ?? name('contrava.scan.execute'),
    repositoryScanQueue: environment.RABBITMQ_REPO_SCAN_QUEUE ?? name('contrava.repository.scan'),
    deadLetterExchange: environment.RABBITMQ_DLX ?? name('contrava.dlx'),
    deadLetterQueue: environment.RABBITMQ_DLQ ?? name('contrava.scan.dead'),
    scanRoutingKey: 'scan.execute',
    repositoryScanRoutingKey: 'repository.scan',
    deadRoutingKey: 'scan.dead',
    repositoryDeadRoutingKey: 'repository.dead',
    repositoryDeadLetterQueue: name('contrava.repository.dead'),
    retryQueues: [
      { queue: name('contrava.scan.retry.5s'), routingKey: 'scan.retry.5s', ttlMs: 5_000 },
      { queue: name('contrava.scan.retry.15s'), routingKey: 'scan.retry.15s', ttlMs: 15_000 },
      { queue: name('contrava.scan.retry.60s'), routingKey: 'scan.retry.60s', ttlMs: 60_000 },
    ],
    repositoryRetryQueues: [
      { queue: name('contrava.repository.retry.15s'), routingKey: 'repository.retry.15s', ttlMs: 15_000 },
      { queue: name('contrava.repository.retry.60s'), routingKey: 'repository.retry.60s', ttlMs: 60_000 },
      { queue: name('contrava.repository.retry.300s'), routingKey: 'repository.retry.300s', ttlMs: 300_000 },
    ],
  };
}

export async function declareTopology(channel: Channel, topology: RabbitTopology): Promise<void> {
  await channel.assertExchange(topology.jobsExchange, 'direct', { durable: true });
  await channel.assertExchange(topology.retryExchange, 'direct', { durable: true });
  await channel.assertExchange(topology.deadLetterExchange, 'direct', { durable: true });
  await channel.assertQueue(topology.scanQueue, { durable: true, arguments: { 'x-dead-letter-exchange': topology.deadLetterExchange, 'x-dead-letter-routing-key': topology.deadRoutingKey } });
  await channel.bindQueue(topology.scanQueue, topology.jobsExchange, topology.scanRoutingKey);
  await channel.assertQueue(topology.repositoryScanQueue, { durable: true, arguments: { 'x-dead-letter-exchange': topology.deadLetterExchange, 'x-dead-letter-routing-key': topology.repositoryDeadRoutingKey } });
  await channel.bindQueue(topology.repositoryScanQueue, topology.jobsExchange, topology.repositoryScanRoutingKey);
  await channel.assertQueue(topology.deadLetterQueue, { durable: true });
  await channel.bindQueue(topology.deadLetterQueue, topology.deadLetterExchange, topology.deadRoutingKey);
  await channel.assertQueue(topology.repositoryDeadLetterQueue, { durable: true });
  await channel.bindQueue(topology.repositoryDeadLetterQueue, topology.deadLetterExchange, topology.repositoryDeadRoutingKey);
  for (const retry of topology.retryQueues) {
    await channel.assertQueue(retry.queue, { durable: true, arguments: { 'x-message-ttl': retry.ttlMs, 'x-dead-letter-exchange': topology.jobsExchange, 'x-dead-letter-routing-key': topology.scanRoutingKey } });
    await channel.bindQueue(retry.queue, topology.retryExchange, retry.routingKey);
  }
  for (const retry of topology.repositoryRetryQueues) {
    await channel.assertQueue(retry.queue, { durable: true, arguments: { 'x-message-ttl': retry.ttlMs, 'x-dead-letter-exchange': topology.jobsExchange, 'x-dead-letter-routing-key': topology.repositoryScanRoutingKey } });
    await channel.bindQueue(retry.queue, topology.retryExchange, retry.routingKey);
  }
}

export function repositoryRetryRoutingKey(attempt: number): string {
  if (attempt <= 1) return 'repository.retry.15s';
  if (attempt === 2) return 'repository.retry.60s';
  return 'repository.retry.300s';
}

export function retryRoutingKey(attempt: number): string {
  if (attempt <= 1) return 'scan.retry.5s';
  if (attempt === 2) return 'scan.retry.15s';
  return 'scan.retry.60s';
}
