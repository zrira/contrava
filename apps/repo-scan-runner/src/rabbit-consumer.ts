import { connect, type Channel, type ChannelModel, type ConsumeMessage } from 'amqplib';
import { declareTopology, topologyFromEnv } from '@contrava/rabbitmq';
import { isRepositoryScanMessage } from '@contrava/shared';
import { RepositoryApiClient } from './api-client.js';
import { GitHubClient, GitHubError } from './github-client.js';
import { log } from './logger.js';
import { RepositoryScanner } from './repository-scanner.js';

export class RepositoryScanConsumer {
  private connection: ChannelModel | undefined; private channel: Channel | undefined; private consumerTag: string | undefined;
  private reconnectTask: Promise<void> | undefined; private stopping = false; private active = 0;
  private readonly topology = topologyFromEnv();
  constructor(private readonly api: RepositoryApiClient, private readonly github: GitHubClient, private readonly scanner: RepositoryScanner, readonly options: { runnerId: string; rabbitUrl: string; prefetch: number; heartbeatMs: number }) {}
  get activeScans() { return this.active; } get connected() { return Boolean(this.channel); }
  start(): void { this.reconnectTask = this.connectionLoop(); }
  private async connectionLoop(): Promise<void> {
    let delay = 500;
    while (!this.stopping) {
      try { await this.connect(); delay = 500; await new Promise<void>((resolve) => this.connection?.once('close', resolve)); }
      catch (error) { if (!this.stopping) log('rabbit connection failed', { error: error instanceof Error ? error.message : 'Unknown error', retryInMs: delay }); }
      finally { this.channel = undefined; this.connection = undefined; }
      if (!this.stopping) { await new Promise((resolve) => setTimeout(resolve, delay)); delay = Math.min(delay * 2, 10_000); }
    }
  }
  private async connect(): Promise<void> {
    const connection = await connect(this.options.rabbitUrl); connection.on('error', (error) => log('rabbit connection error', { error: error.message }));
    const channel = await connection.createChannel(); await declareTopology(channel, this.topology); await channel.prefetch(this.options.prefetch);
    const consumer = await channel.consume(this.topology.repositoryScanQueue, (message) => { if (message) void this.handle(channel, message); }, { noAck: false });
    this.connection = connection; this.channel = channel; this.consumerTag = consumer.consumerTag;
    log('consumer ready', { runnerId: this.options.runnerId, queue: this.topology.repositoryScanQueue, prefetch: this.options.prefetch });
  }
  async handle(channel: Pick<Channel, 'ack' | 'nack' | 'reject'>, message: ConsumeMessage): Promise<void> {
    this.active += 1;
    let payload: unknown;
    try { payload = JSON.parse(message.content.toString('utf8')) as unknown; }
    catch { channel.reject(message, false); this.active -= 1; return; }
    if (!isRepositoryScanMessage(payload)) { channel.reject(message, false); this.active -= 1; return; }
    const fields = { messageId: payload.messageId, repositoryScanId: payload.repositoryScanId, repositoryId: payload.repositoryId, correlationId: payload.correlationId, runnerId: this.options.runnerId };
    try {
      const delivery = await this.api.claim(payload.repositoryScanId, this.options.runnerId, payload.correlationId);
      if (delivery.disposition === 'COMPLETED') { channel.ack(message); return; }
      if (delivery.disposition === 'TERMINAL' || delivery.disposition === 'NOT_FOUND') { channel.reject(message, false); return; }
      if (delivery.disposition === 'BUSY') { await new Promise((resolve) => setTimeout(resolve, Math.min(delivery.retryAfterMs, 30_000))); channel.nack(message, false, true); return; }
      const claim = delivery.scan;
      let heartbeat: NodeJS.Timeout | undefined;
      try {
        const repository = await this.github.repository(claim.owner, claim.name);
        const commitSha = claim.commitSha ?? await this.github.resolveCommit(claim.owner, claim.name, claim.branch ?? repository.default_branch);
        const resolved = await this.api.resolve(claim.scanId, claim.claimToken, claim.runnerId, { commitSha, defaultBranch: repository.default_branch, externalRepositoryId: String(repository.id) }, payload.correlationId);
        if (resolved.alreadyIndexed) { channel.ack(message); return; }
        heartbeat = setInterval(() => void this.api.heartbeat(claim.scanId, claim.claimToken, claim.runnerId, payload.correlationId).catch((error: unknown) => log('heartbeat failed', { ...fields, error: error instanceof Error ? error.message : 'Unknown error' })), this.options.heartbeatMs); heartbeat.unref();
        const result = await this.scanner.scan({ ...claim, commitSha, branch: claim.branch ?? repository.default_branch });
        await this.api.complete(claim.scanId, { claimToken: claim.claimToken, runnerId: claim.runnerId, commitSha: result.commitSha, defaultBranch: result.defaultBranch, externalRepositoryId: result.externalRepositoryId, fullScan: result.fullScan, files: result.files, deletedPaths: result.deletedPaths, indexedPaths: result.indexedPaths, filesSkipped: result.filesSkipped }, payload.correlationId);
        channel.ack(message);
        log('repository scan completed', { ...fields, commitSha, files: result.files.length, totalBytes: result.metrics.totalBytes, parseTimeMs: result.metrics.parseTimeMs, totalTimeMs: result.metrics.totalTimeMs });
      } catch (error) {
        const githubError = error instanceof GitHubError ? error : null;
        const failed = await this.api.fail(claim.scanId, { claimToken: claim.claimToken, runnerId: claim.runnerId, error: error instanceof Error ? error.message : 'Repository scan failed', retryable: githubError?.retryable ?? true, ...(githubError?.rateLimited ? { rateLimited: true } : {}), ...(githubError?.resetAt ? { retryAt: githubError.resetAt.toISOString() } : {}) }, payload.correlationId);
        if (failed.status === 'FAILED') channel.reject(message, false); else channel.ack(message);
        log('repository scan failed', { ...fields, retryable: githubError?.retryable ?? true, rateLimited: githubError?.rateLimited ?? false, error: error instanceof Error ? error.message : 'Unknown error' });
      } finally { if (heartbeat) clearInterval(heartbeat); }
    } catch (error) { log('delivery handling failed', { ...fields, error: error instanceof Error ? error.message : 'Unknown error' }); channel.nack(message, false, true); }
    finally { this.active -= 1; }
  }
  async stop(graceMs: number): Promise<void> {
    this.stopping = true; if (this.channel && this.consumerTag) await this.channel.cancel(this.consumerTag).catch(() => undefined);
    const deadline = Date.now() + graceMs; while (this.active && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
    await this.channel?.close().catch(() => undefined); await this.connection?.close().catch(() => undefined); await this.reconnectTask;
  }
}
