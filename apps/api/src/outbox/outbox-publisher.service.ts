import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { connect, type ChannelModel, type ConfirmChannel } from 'amqplib';
import { declareTopology, topologyFromEnv } from '@contrava/rabbitmq';
import type { ScanExecuteMessage } from '@contrava/shared';
import { OutboxRepository } from './outbox.repository';

@Injectable()
export class OutboxPublisherService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private connection?: ChannelModel;
  private channel?: ConfirmChannel;
  private connecting?: Promise<ConfirmChannel>;
  private publishing?: Promise<void>;
  private stopping = false;
  private reconnectDelayMs = 500;
  private nextConnectAt = 0;
  private readonly enabled = (process.env.JOB_DELIVERY_MODE ?? 'rabbitmq') === 'rabbitmq';
  private readonly intervalMs = Number(process.env.OUTBOX_POLL_INTERVAL_MS ?? 500);
  private readonly batchSize = Number(process.env.OUTBOX_BATCH_SIZE ?? 50);
  private readonly rabbitUrl = process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672';
  private readonly topology = topologyFromEnv();

  constructor(private readonly repository: OutboxRepository) {}

  onModuleInit(): void {
    if (!this.enabled) return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref();
    void this.tick();
  }

  async tick(): Promise<void> {
    if (this.stopping || this.publishing) return;
    this.publishing = this.publishBatch().finally(() => { this.publishing = undefined; });
    await this.publishing;
  }

  private async publishBatch(): Promise<void> {
    let channel: ConfirmChannel;
    try { channel = await this.ensureChannel(); }
    catch (error) {
      if (!(error instanceof Error && error.message === 'RabbitMQ reconnect backoff active')) console.error(JSON.stringify({ service: 'api', event: 'rabbit connection failed', error: error instanceof Error ? error.message : 'Connection failed' }));
      return;
    }
    const messages = await this.repository.claimBatch(this.batchSize);
    if (!messages.length) return;
    const started = performance.now();
    try {
      for (const message of messages) {
        const payload = message.payload as unknown as ScanExecuteMessage;
        channel.publish(message.topic, message.routingKey, Buffer.from(JSON.stringify(payload)), {
          persistent: true,
          contentType: 'application/json',
          messageId: message.id,
          correlationId: payload.correlationId,
          timestamp: Date.now(),
        });
      }
      await channel.waitForConfirms();
      await Promise.all(messages.map((message) => this.repository.markPublished(message.id, message.lockToken)));
      console.info(JSON.stringify({ service: 'api', event: 'outbox published', transaction: 'publisherConfirm', publishCount: messages.length, durationMs: Math.round(performance.now() - started) }));
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'RabbitMQ publish failed';
      await Promise.all(messages.map((message) => this.repository.release(message.id, message.lockToken, reason)));
      this.clearConnection();
      console.error(JSON.stringify({ service: 'api', event: 'outbox publish failed', publishCount: messages.length, error: reason }));
    }
  }

  private ensureChannel(): Promise<ConfirmChannel> {
    if (this.channel) return Promise.resolve(this.channel);
    if (this.connecting) return this.connecting;
    if (Date.now() < this.nextConnectAt) return Promise.reject(new Error('RabbitMQ reconnect backoff active'));
    this.connecting = (async () => {
      const connection = await connect(this.rabbitUrl);
      connection.on('error', () => this.clearConnection());
      connection.on('close', () => this.clearConnection());
      const channel = await connection.createConfirmChannel();
      await declareTopology(channel, this.topology);
      this.connection = connection;
      this.channel = channel;
      this.reconnectDelayMs = 500;
      this.nextConnectAt = 0;
      return channel;
    })().catch((error: unknown) => {
      this.nextConnectAt = Date.now() + this.reconnectDelayMs;
      this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, 10_000);
      throw error;
    }).finally(() => { this.connecting = undefined; });
    return this.connecting;
  }

  async health() {
    if (!this.enabled) return { status: 'DISABLED' as const, dlqDepth: null };
    const started = performance.now();
    try {
      const channel = await this.ensureChannel();
      const queue = await channel.checkQueue(this.topology.deadLetterQueue);
      return { status: 'HEALTHY' as const, latencyMs: Math.round(performance.now() - started), dlqDepth: queue.messageCount };
    } catch (error) {
      this.clearConnection();
      return { status: 'UNAVAILABLE' as const, error: error instanceof Error ? error.message : 'Connection failed', dlqDepth: null };
    }
  }

  private clearConnection(): void {
    const connection = this.connection;
    this.channel = undefined;
    this.connection = undefined;
    if (connection) void connection.close().catch(() => undefined);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    await this.publishing;
    const channel = this.channel;
    const connection = this.connection;
    this.channel = undefined;
    this.connection = undefined;
    await channel?.close().catch(() => undefined);
    await connection?.close().catch(() => undefined);
  }
}
