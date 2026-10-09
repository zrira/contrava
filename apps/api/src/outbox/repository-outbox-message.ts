import { randomUUID } from 'node:crypto';
import { topologyFromEnv } from '@contrava/rabbitmq';
import type { RepositoryScanMessage } from '@contrava/shared';
import type { Prisma } from '@prisma/client';

interface ScanIdentity { id: string; repositoryId: string; commitSha: string | null }

export async function createRepositoryScanOutbox(
  transaction: Prisma.TransactionClient,
  scan: ScanIdentity,
  correlationId: string,
  options: { routingKey?: string; availableAt?: Date } = {},
) {
  const topology = topologyFromEnv();
  const id = randomUUID();
  const payload: RepositoryScanMessage = { version: 1, messageId: id, repositoryScanId: scan.id, repositoryId: scan.repositoryId, commitSha: scan.commitSha, correlationId, createdAt: new Date().toISOString() };
  return transaction.outboxMessage.create({ data: {
    id, repositoryScanId: scan.id, availableAt: options.availableAt,
    topic: options.routingKey ? topology.retryExchange : topology.jobsExchange,
    routingKey: options.routingKey ?? topology.repositoryScanRoutingKey,
    payload: payload as unknown as Prisma.InputJsonValue,
  } });
}
