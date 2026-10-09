# RabbitMQ delivery and transactional outbox

PostgreSQL remains Contrava's authoritative business-state store. RabbitMQ carries delivery notifications; it does not own job lifecycle state. This split gives the runner push delivery without a database/message dual-write gap.

## Topology

All declarations are durable and idempotent. Messages are published as persistent.

| Kind | Default name | Binding / purpose |
| --- | --- | --- |
| Direct exchange | `contrava.jobs` | Primary scan delivery |
| Queue | `contrava.scan.execute` | `scan.execute`; dead-letters rejected messages |
| Direct exchange | `contrava.retry` | Delayed retry entry point |
| TTL queues | `contrava.scan.retry.5s`, `.15s`, `.60s` | Bound by matching `scan.retry.*` key; expire to `contrava.jobs/scan.execute` |
| Direct exchange | `contrava.dlx` | Terminal and poison delivery |
| Queue | `contrava.scan.dead` | `scan.dead` |

`RABBITMQ_TOPOLOGY_PREFIX` isolates integration-test topology. Production names may be overridden, but every API publisher and runner must use identical values.

## Message contract

Version 1 is deliberately small:

```json
{
  "version": 1,
  "messageId": "outbox UUID",
  "jobId": "ScanJob UUID",
  "apiId": "TrackedApi UUID",
  "correlationId": "request correlation ID",
  "createdAt": "ISO-8601 timestamp"
}
```

The message contains identity, not mutable business state. After delivery, the runner asks the API to claim `jobId`; the API returns the current specification URL, baseline, attempt, claim token, and lease.

## Producer invariant

Manual enqueue and scheduled enqueue each use one PostgreSQL transaction:

1. insert `ScanJob`;
2. insert its `OutboxMessage` with the complete envelope;
3. commit both, or neither.

The publisher claims pending outbox rows in bounded batches with `FOR UPDATE SKIP LOCKED`, then commits before network I/O. It publishes to a durable exchange, waits for RabbitMQ publisher confirms, and changes rows to `PUBLISHED` only after confirmation. A failed or ambiguous publish releases the row as `PENDING`; a later pass republishes it. Therefore delivery is **at least once**, never exactly once.

Outbox locks expire after 30 seconds so another API process can recover work abandoned by a crashed publisher. `attemptCount` and `lastError` expose repeated publication trouble. Broker outages do not roll back accepted jobs.

## Consumer invariant

The runner uses manual acknowledgement and prefetch bounded by `RABBITMQ_PREFETCH` (normally equal to `MAX_CONCURRENT_JOBS`). It ACKs only after one of these durable outcomes:

- completion was committed by the API;
- a retry state and retry outbox message were committed together;
- the API reports that the job was already completed.

Malformed/unsupported messages and messages for missing or terminal jobs are rejected without requeue and enter the DLQ. A terminal execution failure is first persisted as `FAILED`, marked dead-lettered for metrics, and then rejected.

A duplicate message is harmless. Claim-by-ID locks the job and returns `CLAIMED`, `BUSY`, `COMPLETED`, `TERMINAL`, or `NOT_FOUND`. `COMPLETED` is ACKed without worker calls. Active unexpired ownership returns `BUSY`; the delivery remains unacknowledged briefly, then is requeued. Expired ownership receives a new token. Every start, heartbeat, complete, and fail call still validates runner ID, token, state, and lease.

## Retries

Execution attempts are authoritative in `ScanJob`, not RabbitMQ headers. With the default `maxAttempts=4`:

| Failed attempt | Durable job state | Outbox route | Delay |
| ---: | --- | --- | ---: |
| 1 | `RETRY_SCHEDULED` | `scan.retry.5s` | 5 s |
| 2 | `RETRY_SCHEDULED` | `scan.retry.15s` | 15 s |
| 3 | `RETRY_SCHEDULED` | `scan.retry.60s` | 60 s |
| 4 | `FAILED` | reject to `scan.dead` | terminal |

Retry queues use queue TTL plus dead-letter routing back to the primary exchange. The runner ACKs the old delivery only after the retry transaction commits.

## Failure matrix

| Failure point | Durable result | Recovery |
| --- | --- | --- |
| API crashes before enqueue commit | no job and no message | caller retries request |
| API commits, broker is down | job + pending outbox | publisher reconnects with 0.5–10 s bounded backoff |
| Publisher sends, loses confirm | pending outbox may publish again | consumer idempotency handles duplicate |
| Publisher crashes after confirm, before DB update | pending outbox may publish again | consumer idempotency handles duplicate |
| Runner crashes before claim | unacked broker delivery | RabbitMQ requeues |
| Runner crashes during execution | job lease remains; broker requeues | consumers wait/requeue until lease expiry, then reclaim |
| API commits completion, response/ACK is lost | completed job + redelivery | claim returns `COMPLETED`; consumer ACKs |
| Retry transaction commits, old ACK is lost | retry outbox plus old redelivery | active/retry state prevents duplicate work; eventual retry runs |
| Poison envelope | no business-state change | reject to DLQ |

## Operations

Required configuration:

```bash
JOB_DELIVERY_MODE=rabbitmq
RABBITMQ_URL=amqp://user:password@host:5672/vhost
RABBITMQ_PREFETCH=2
OUTBOX_POLL_INTERVAL_MS=500
OUTBOX_BATCH_SIZE=50
MAX_JOB_ATTEMPTS=4
```

Use a least-privilege RabbitMQ user in real environments and never commit credentials. `JOB_DELIVERY_MODE=postgres-polling` retains the Phase 3 polling path as an explicit fallback; do not run polling and RabbitMQ delivery for the same queue during normal operation.

`GET /health` reports broker status/latency, DLQ depth, and pending/failed outbox counts. `GET /jobs/metrics` reports published messages, outbox backlog, dead-lettered jobs, and normal job/lease metrics. Logs include message, job, API, runner, and correlation IDs at consumer boundaries.

Operational response:

1. **Broker unavailable:** leave API accepting jobs; verify outbox backlog rises; restore RabbitMQ; confirm backlog drains.
2. **Outbox stuck:** inspect `lastError`, broker permissions/topology, and API logs. Rows locked longer than 30 seconds are automatically reclaimable.
3. **DLQ non-empty:** inspect poison/terminal reasons before replay. Do not blindly move messages; the PostgreSQL job may already be terminal or completed.
4. **Runner unavailable:** messages stay ready/unacknowledged in RabbitMQ. Start runners and monitor queue depth and leases.
5. **Safe restart:** stop consumers, allow the runner grace period, restart RabbitMQ/API/runners, and expect possible duplicates.

## Verification

```bash
TEST_DATABASE_URL=postgresql://contrava:contrava@localhost:5432/contrava_test \
RABBITMQ_URL=amqp://guest:guest@localhost:5672 npm run test:rabbitmq
```

The isolated suite resets only a database whose name includes `test`, uses prefixed RabbitMQ topology, and covers transactional creation, publisher confirms, broker-unavailable recovery, delayed retry, and DLQ routing. Unit tests cover malformed envelopes, duplicate completion, ACK-after-commit ordering, and a crash/lost-response redelivery.
