# Queue performance experiment

This is a development learning baseline, not a production capacity claim.

## Environment

- Intel Core i5-7200U, 4 logical CPUs
- 7.1 GiB RAM (system was memory-constrained during the run)
- Node.js 24.15.0
- PostgreSQL 18.6, local Unix socket
- 200 synthetic jobs per run
- claim batch size: 1
- one NestJS API process, Prisma connection limit 30
- synthetic execution calls the real claim/start/complete HTTP endpoints but does not fetch or diff an OpenAPI document
- all jobs target one API, intentionally exercising the per-API snapshot-completion lock

Run the utility against an empty development database and running API:

```bash
npm run load:jobs -- --jobs=1000 --runners=4
# Optional: --batch=10 --api-id=<existing-api-id> --api-url=http://localhost:3000
```

## Representative result

| Synthetic runners | Jobs | Total ms | Jobs/sec | Avg claim ms | Avg execution ms | p95 execution ms | Errors |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 200 | 5,956 | 33.58 | 7.85 | 21.88 | 24.89 | 0 |
| 2 | 200 | 3,564 | 56.11 | 8.77 | 26.71 | 32.66 | 0 |
| 4 | 200 | 3,712 | 53.88 | 12.53 | 61.00 | 90.70 | 0 |
| 8 | 200 | 3,559 | 56.19 | 15.18 | 124.79 | 206.29 | 0 |

## Interpretation

A second runner improved throughput substantially. Four and eight did not improve it further and increased latency. The experiment targets one API, so completion intentionally serializes on that API row to preserve snapshot baseline order; HTTP and the small machine also add contention. Real scans spend much more time in remote fetch/diff work and target many APIs, so their scaling profile will differ.

The useful lesson is not the absolute jobs/second number: adding consumers eventually stops helping when the bottleneck moves to database connections, row contention, CPU, or the protected business invariant. Batch claims reduce claim round trips, while `SKIP LOCKED` prevents consumers from waiting behind the same queue rows.

## Phase 4 RabbitMQ comparison

The Phase 4 utility uses real durable RabbitMQ publication, broker delivery, claim-by-ID, manual ACKs, and the real start/complete HTTP endpoints. The timer includes creating APIs, enqueueing all jobs, outbox polling/publication, delivery, and completion. Worker fetch/diff calls remain synthetic. The comparison below again targets one API and uses prefetch 10.

```bash
npm run load:rabbitmq -- --jobs=200 --runners=4 --apis=1 --prefetch=10
```

| Synthetic consumers | Jobs | Total ms | Jobs/sec | Avg delivery ms | p95 delivery ms | Avg execution ms | p95 execution ms |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 200 | 4,607 | 43.41 | 2,012.22 | 2,779 | 145.18 | 294.27 |
| 2 | 200 | 4,405 | 45.40 | 1,254.68 | 1,834 | 264.01 | 392.77 |
| 4 | 200 | 4,361 | 45.86 | 870.51 | 1,281 | 436.08 | 555.02 |

The Phase 3 and Phase 4 numbers are directional rather than a strict transport benchmark: their timers and claim paths differ. RabbitMQ removed repeated empty database polls and reduced delivery latency as consumers increased, while end-to-end throughput still plateaued around the PostgreSQL/API completion path. Higher concurrency increased execution latency because all jobs intentionally contended on one API. A separate 10-API run reached 55.95 jobs/sec with two consumers, showing that the protected per-API baseline remains more important than broker throughput at this scale.

Tune `RABBITMQ_PREFETCH` near actual execution concurrency. Large prefetch values reduce broker round trips but reserve work on individual runners and can increase redelivery recovery time. Monitor outbox depth, ready/unacknowledged queue depth, DLQ depth, completion latency, PostgreSQL pool saturation, and per-API contention before raising consumer counts.
