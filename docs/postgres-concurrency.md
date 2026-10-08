# PostgreSQL concurrency model

## Why PostgreSQL

Phase 2 deliberately built queue mechanics on SQLite: persisted rows, conditional claims, leases, retries, and idempotent completion. SQLite made those ideas visible but serializes writers at the database-file level and has no row-level `FOR UPDATE` lock or `SKIP LOCKED`. That limits useful parallel consumers.

Phase 3 keeps the same product boundaries while moving the NestJS-owned durable state to PostgreSQL:

```text
Phase 2                       Phase 3                         Phase 4 (future)
SQLite persisted jobs   ->   PostgreSQL persisted jobs  ->  optional broker
conditional updates          row locks + SKIP LOCKED         Redis/BullMQ or RabbitMQ
leases                       batch claims + leases           broker delivery/acks
```

A broker is not automatically required. PostgreSQL is a practical queue for many moderate workloads, especially when jobs must coordinate closely with relational product state. Building this phase teaches the correctness requirements that remain relevant with a broker.

## Migration strategy

The learning environment has no production data, so the repository replaces its SQLite migration history with a fresh PostgreSQL baseline:

```text
SQLite schema review
  -> map strings to enums and text/JSON to PostgreSQL types
  -> create PostgreSQL baseline migration
  -> migrate a fresh development database
  -> run concurrency and end-to-end verification
```

A production migration would be a separate operational project:

1. deploy a PostgreSQL-compatible schema;
2. backfill in repeatable batches while preserving IDs and timestamps;
3. verify row counts, hashes, foreign keys, and sampled records;
4. optionally dual-write or pause writes during a short cutover;
5. switch reads, monitor, then switch writes;
6. keep the SQLite backup and a tested rollback window;
7. remove compatibility code only after verification.

Contrava does **not** implement dual writes.

## PostgreSQL schema choices

- IDs stay UUIDs but now use native `uuid` columns.
- lifecycle values use PostgreSQL-backed Prisma enums.
- all durable timestamps use `timestamptz(3)`.
- normalized OpenAPI documents use `jsonb`.
- hashes use `varchar(64)`.
- user-facing and error text remains unbounded `text` where appropriate.
- foreign keys retain cascade behavior from earlier phases.

## MVCC and row locks

PostgreSQL MVCC lets readers observe a consistent row version while writers create new versions. A `FOR UPDATE` lock protects selected rows from conflicting writers until the short transaction commits. `SKIP LOCKED` tells another consumer not to wait on already selected queue rows; it can claim different work instead.

Claiming is isolated in `JobRepository`. Prisma does not expose `FOR UPDATE SKIP LOCKED`, so one narrow parameterized SQL statement is used:

```sql
WITH candidates AS (
  SELECT id
  FROM "ScanJob"
  WHERE due OR lease_expired
  ORDER BY "scheduledFor", "createdAt"
  FOR UPDATE SKIP LOCKED
  LIMIT $capacity
)
UPDATE "ScanJob" job
SET status = 'CLAIMED',
    attempt = attempt + 1,
    "claimToken" = gen_random_uuid(),
    "runnerId" = $runner,
    "leaseExpiresAt" = $lease
FROM candidates
WHERE job.id = candidates.id
RETURNING job.id;
```

The claim transaction fetches the job payload and commits before fetching specifications or diffing. No database lock is held during HTTP work. Ordering by `scheduledFor ASC, createdAt ASC` gives older due work priority. Batch size is bounded to 50.

## Transaction boundaries

### Scheduler

A scheduler tick may discover due APIs concurrently. For each API, the transaction selects the still-due API row `FOR UPDATE`, creates the unique `apiId:slot` job, and advances `nextScanAt`. A second scheduler waits for the row, rechecks the due predicate, and finds no work. The unique schedule key is the final correctness constraint.

### Claim

The CTE locks and updates only the selected job rows. It commits before execution starts. Concurrent consumers skip those rows rather than blocking.

### Completion

Completion verifies job ID, active status, claim token, runner ID, and unexpired lease. It then locks the owning API row to serialize snapshot-baseline mutation for that API. Snapshot lookup/create, changes, scan history, API status, and job completion commit together. This API-level lock prevents two valid jobs from racing to insert the same `(apiId, contentHash)` snapshot while still allowing unrelated APIs to complete concurrently.

### Failure

Failure validates current ownership and atomically updates scan status, deterministic retry time or terminal failure, API status when terminal, and clears active lease ownership.

## Stale owners

Reclaim replaces both `claimToken` and `runnerId` and increments the attempt. Start, heartbeat, failure, and completion require both values. Heartbeat additionally requires an active state and a lease that has not already expired. Therefore:

```text
runner A lease expires
runner B reclaims and receives token B
runner A heartbeat/completion with token A -> 409 Conflict
runner B may continue
```

A duplicate completion from the same completed ownership is idempotent; another ownership cannot overwrite it.

## Indexes and query plans

Indexes correspond to actual access paths:

| Index | Query |
| --- | --- |
| `TrackedApi(scanEnabled, nextScanAt)` | due schedule lookup |
| `ScanJob(status, scheduledFor, createdAt)` | ordered due-job claim |
| `ScanJob(status, leaseExpiresAt)` | expired lease recovery/metrics |
| `ScanJob(status, createdAt)` | filtered paginated history |
| `ScanJob(apiId, createdAt)` | per-API history |
| `Scan/ApiSnapshot/ApiChange(apiId, createdAt)` | API timelines |

`EXPLAIN (ANALYZE, BUFFERS)` was inspected on PostgreSQL 18.6. The available-job query used `BitmapOr` over the due-job and lease indexes. Expired lease lookup used `ScanJob_status_leaseExpiresAt_idx`; status-filtered history used `ScanJob_status_createdAt_idx`. The tiny development `TrackedApi` table used a sequential scan because reading one row was cheaper than traversing its index. This is expected and not evidence that the index is unnecessary at realistic cardinality.

Representative observed execution times on the small local data set were approximately 0.20 ms for available-job lookup, 0.10 ms for expired leases, and 0.27 ms for filtered history. These are query-plan observations, not production guarantees.

Useful development commands:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id FROM "TrackedApi"
WHERE "scanEnabled" AND "nextScanAt" <= now()
ORDER BY "nextScanAt" LIMIT 50;

EXPLAIN (ANALYZE, BUFFERS)
SELECT id FROM "ScanJob"
WHERE status = 'FAILED'
ORDER BY "createdAt" DESC LIMIT 25;
```

## Connection pooling

Prisma maintains a pool per `PrismaClient`/API process. A connection avoids reconnecting for every query, but every pool consumes PostgreSQL sessions. Ten API replicas each configured for 20 connections can consume 200 sessions before administrative or migration connections are counted.

Local URLs use conservative parameters:

```text
?connection_limit=10&pool_timeout=10
```

Choose pool size from the database connection budget and number of API instances, not from runner count: runners call the API and do not open database connections. PgBouncer can provide production connection multiplexing later, but is intentionally not introduced in this phase.

## What PostgreSQL does not solve

PostgreSQL does not provide broker push delivery, routing, dead-letter queues, consumer acknowledgements independent of application state, or unlimited throughput. Polling still costs queries; long transactions still cause contention; poison jobs still need policy; and a database outage stops both product persistence and queue delivery. Phase 4 may replace polling/delivery with a broker without rewriting OpenAPI execution logic, but that decision should follow measured need.
