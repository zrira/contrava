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
