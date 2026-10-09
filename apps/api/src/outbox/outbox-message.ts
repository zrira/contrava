import { randomUUID } from 'node:crypto';
import { topologyFromEnv } from '@contrava/rabbitmq';
import type { ScanExecuteMessage } from '@contrava/shared';
import type { Prisma } from '@prisma/client';

interface JobIdentity {
  id: string;
  apiId: string;
  correlationId: string;
}

export async function createScanOutbox(
  transaction: Prisma.TransactionClient,
  job: JobIdentity,
  delivery: 'execute' | 'retry' = 'execute',
  retryRoutingKey?: string,
) {
  const topology = topologyFromEnv();
  const id = randomUUID();
  const payload: ScanExecuteMessage = {
    version: 1,
    messageId: id,
    jobId: job.id,
    apiId: job.apiId,
    correlationId: job.correlationId,
    createdAt: new Date().toISOString(),
  };
  return transaction.outboxMessage.create({
    data: {
      id,
      jobId: job.id,
      apiId: job.apiId,
      topic: delivery === 'execute' ? topology.jobsExchange : topology.retryExchange,
      routingKey: delivery === 'execute' ? topology.scanRoutingKey : retryRoutingKey!,
      payload: payload as unknown as Prisma.InputJsonValue,
    },
  });
}
