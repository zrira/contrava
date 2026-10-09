import { connect, type Channel, type ChannelModel, type ConsumeMessage } from 'amqplib';
import { declareTopology, topologyFromEnv } from '@contrava/rabbitmq';
import { isScanExecuteMessage, type ClaimedJob } from '@contrava/shared';
import type { RunnerApi } from './client.js';
import type { JobExecutor } from './executor.js';
import { log } from './logger.js';

export interface ConsumerOptions {
  runnerId: string;
  rabbitUrl: string;
  prefetch: number;
  heartbeatMs: number;
}

export class RabbitJobConsumer {
  private connection: ChannelModel | undefined;
  private channel: Channel | undefined;
  private consumerTag: string | undefined;
  private stopping = false;
  private active = 0;
  private reconnectTask: Promise<void> | undefined;
  private readonly topology = topologyFromEnv();

  constructor(private readonly api: RunnerApi, private readonly execute: JobExecutor, readonly options: ConsumerOptions) {}
  get activeJobs(): number { return this.active; }
  get connected(): boolean { return Boolean(this.channel); }

  start(): void { this.reconnectTask = this.connectionLoop(); }

  private async connectionLoop(): Promise<void> {
    let delayMs = 500;
    while (!this.stopping) {
      try {
        await this.connectAndConsume();
        delayMs = 500;
        await new Promise<void>((resolve) => this.connection?.once('close', resolve));
      } catch (error) {
        if (!this.stopping) log('rabbit connection failed', { runnerId: this.options.runnerId, error: error instanceof Error ? error.message : 'Unknown error', retryInMs: delayMs });
      } finally {
        this.channel = undefined;
        this.connection = undefined;
      }
      if (!this.stopping) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        delayMs = Math.min(delayMs * 2, 10_000);
      }
    }
  }

  private async connectAndConsume(): Promise<void> {
    const connection = await connect(this.options.rabbitUrl);
    connection.on('error', (error) => log('rabbit connection error', { runnerId: this.options.runnerId, error: error.message }));
    const channel = await connection.createChannel();
    await declareTopology(channel, this.topology);
    await channel.prefetch(this.options.prefetch);
    const result = await channel.consume(this.topology.scanQueue, (message) => {
      if (message) void this.handleMessage(channel, message);
    }, { noAck: false });
    this.connection = connection;
    this.channel = channel;
    this.consumerTag = result.consumerTag;
    log('rabbit consumer ready', { runnerId: this.options.runnerId, queue: this.topology.scanQueue, prefetch: this.options.prefetch });
  }

  async handleMessage(channel: Pick<Channel, 'ack' | 'nack' | 'reject'>, message: ConsumeMessage): Promise<void> {
    this.active += 1;
    let payload: unknown;
    try { payload = JSON.parse(message.content.toString('utf8')) as unknown; }
    catch { channel.reject(message, false); this.active -= 1; return; }
    if (!isScanExecuteMessage(payload)) { channel.reject(message, false); this.active -= 1; return; }

    const fields = { messageId: payload.messageId, jobId: payload.jobId, apiId: payload.apiId, runnerId: this.options.runnerId, correlationId: payload.correlationId, redelivered: message.fields.redelivered };
    try {
      const delivery = await this.api.claimDelivery(payload.jobId, this.options.runnerId, payload.correlationId);
      if (delivery.disposition === 'COMPLETED') { channel.ack(message); log('duplicate delivery acknowledged', fields); return; }
      if (delivery.disposition === 'TERMINAL' || delivery.disposition === 'NOT_FOUND') {
        if (delivery.disposition === 'TERMINAL') await this.api.markDeadLettered(payload.jobId, payload.correlationId);
        channel.reject(message, false);
        return;
      }
      if (delivery.disposition === 'BUSY') {
        await new Promise((resolve) => setTimeout(resolve, Math.min(delivery.retryAfterMs, 30_000)));
        channel.nack(message, false, true);
        return;
      }
      await this.processClaimed(channel, message, delivery.job, payload.correlationId, fields);
    } catch (error) {
      log('delivery handling failed', { ...fields, error: error instanceof Error ? error.message : 'Unknown error' });
      channel.nack(message, false, true);
    } finally { this.active -= 1; }
  }

  private async processClaimed(channel: Pick<Channel, 'ack' | 'reject'>, message: ConsumeMessage, job: ClaimedJob, requestId: string, fields: Record<string, unknown>): Promise<void> {
    let heartbeat: NodeJS.Timeout | undefined;
    try {
      await this.api.start(job, requestId);
      heartbeat = setInterval(() => void this.api.heartbeat(job, requestId).catch((error: unknown) => log('heartbeat failed', { ...fields, error: error instanceof Error ? error.message : 'Unknown error' })), this.options.heartbeatMs);
      heartbeat.unref();
      const result = await this.execute(job, requestId);
      await this.api.complete(job, result, requestId);
      channel.ack(message);
      log('rabbit job completed and acknowledged', { ...fields, attempt: job.attempt });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown job error';
      const failed = await this.api.fail(job, reason, requestId);
      if (failed.status === 'RETRY_SCHEDULED' || failed.status === 'COMPLETED') {
        channel.ack(message);
        log('rabbit job retry persisted', { ...fields, attempt: job.attempt });
      } else {
        await this.api.markDeadLettered(job.id, requestId);
        channel.reject(message, false);
        log('rabbit job dead-lettered', { ...fields, attempt: job.attempt });
      }
    } finally { if (heartbeat) clearInterval(heartbeat); }
  }

  async stop(graceMs: number): Promise<void> {
    this.stopping = true;
    if (this.channel && this.consumerTag) await this.channel.cancel(this.consumerTag).catch(() => undefined);
    const deadline = Date.now() + graceMs;
    while (this.active > 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
    await this.channel?.close().catch(() => undefined);
    await this.connection?.close().catch(() => undefined);
    await this.reconnectTask;
  }
}
