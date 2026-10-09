import { describe, expect, it, vi } from 'vitest';
import type { ConsumeMessage } from 'amqplib';
import type { ClaimedJob, JobDeliveryDisposition, ScanExecuteMessage } from '@contrava/shared';
import type { RunnerApi } from './client.js';
import { RabbitJobConsumer } from './rabbit-consumer.js';

const payload: ScanExecuteMessage = { version: 1, messageId: 'message-1', jobId: 'job-1', apiId: 'api-1', correlationId: 'request-1', createdAt: new Date().toISOString() };
const job: ClaimedJob = { id: 'job-1', apiId: 'api-1', specUrl: 'https://example.com/spec', attempt: 1, maxAttempts: 4, claimToken: 'token', runnerId: 'runner', leaseExpiresAt: new Date(Date.now() + 30_000).toISOString(), previousSnapshot: null };
const message = (body: unknown = payload) => ({ content: Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)), fields: { redelivered: false }, properties: {} }) as ConsumeMessage;
const channel = () => ({ ack: vi.fn(), nack: vi.fn(), reject: vi.fn() });

function api(disposition: JobDeliveryDisposition): RunnerApi {
  return {
    claim: vi.fn().mockResolvedValue([]), claimDelivery: vi.fn().mockResolvedValue(disposition), markDeadLettered: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue(undefined), heartbeat: vi.fn().mockResolvedValue(undefined), complete: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn().mockResolvedValue({ status: 'RETRY_SCHEDULED', attempt: 1, maxAttempts: 4 }),
  };
}

const options = { runnerId: 'runner', rabbitUrl: 'amqp://unused', prefetch: 2, heartbeatMs: 60_000 };

describe('RabbitJobConsumer acknowledgement safety', () => {
  it('rejects malformed envelopes to the dead-letter exchange', async () => {
    const broker = channel();
    await new RabbitJobConsumer(api({ disposition: 'NOT_FOUND' }), vi.fn(), options).handleMessage(broker as never, message('{bad'));
    expect(broker.reject).toHaveBeenCalledWith(expect.anything(), false);
  });

  it('acknowledges a duplicate completed delivery without executing it', async () => {
    const broker = channel(); const execute = vi.fn();
    await new RabbitJobConsumer(api({ disposition: 'COMPLETED' }), execute, options).handleMessage(broker as never, message());
    expect(broker.ack).toHaveBeenCalledOnce(); expect(execute).not.toHaveBeenCalled();
  });

  it('acknowledges only after completion is durable', async () => {
    const broker = channel(); const client = api({ disposition: 'CLAIMED', job });
    await new RabbitJobConsumer(client, vi.fn().mockResolvedValue({ hash: 'h', spec: {}, previousSnapshotId: null, changes: [] }), options).handleMessage(broker as never, message());
    expect(client.complete).toHaveBeenCalledOnce(); expect(broker.ack).toHaveBeenCalledOnce();
    expect((client.complete as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]).toBeLessThan(broker.ack.mock.invocationCallOrder[0]!);
  });

  it('requeues after a lost completion response and safely acks the redelivery', async () => {
    const broker = channel(); const client = api({ disposition: 'CLAIMED', job });
    (client.complete as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('connection reset'));
    (client.fail as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('already completed'));
    const consumer = new RabbitJobConsumer(client, vi.fn().mockResolvedValue({ hash: 'h', spec: {}, previousSnapshotId: null, changes: [] }), options);
    await consumer.handleMessage(broker as never, message());
    expect(broker.nack).toHaveBeenCalledWith(expect.anything(), false, true);
    (client.claimDelivery as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ disposition: 'COMPLETED' });
    await consumer.handleMessage(broker as never, message());
    expect(broker.ack).toHaveBeenCalledOnce();
  });
});
