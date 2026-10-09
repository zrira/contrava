# Contrava

**Contrava — API contracts that watch themselves.**

Contrava monitors OpenAPI contracts and reports breaking changes before they surprise production consumers. It registers APIs, schedules or manually queues scans, stores snapshots, compares changed specifications, classifies changes, and displays job and contract history.

## Services

| Service | Port | Purpose |
| --- | ---: | --- |
| `@contrava/web` | 5173 | React control UI |
| `@contrava/api` | 3000 | NestJS control plane, scheduler, job API, and persistence |
| `@contrava/spec-worker` | 3001 | Fetch, parse, normalize, and hash OpenAPI documents |
| `@contrava/scan-worker` | 3002 | Deterministic OpenAPI contract diffing |
| `@contrava/scan-runner` | 3003 | Consume, lease, heartbeat, and execute RabbitMQ-delivered jobs |

## Prerequisites

- Node.js 20 or newer
- npm 10 or newer
- PostgreSQL 14 or newer (tested locally with PostgreSQL 18)
- RabbitMQ 3.12 or newer (tested locally with RabbitMQ 4)

## Local PostgreSQL setup

Create a local role and separate development/test databases using an administrative PostgreSQL account:

```bash
psql -d postgres -c "CREATE USER contrava WITH PASSWORD 'contrava';"
createdb --owner=contrava contrava
createdb --owner=contrava contrava_test
```

If the role or databases already exist, reuse them rather than recreating them. Create or obtain a local RabbitMQ account/vhost and set `RABBITMQ_URL`. The localhost examples use RabbitMQ's development-only `guest` account. Then initialize Contrava:

```bash
npm install
cp apps/api/.env.example apps/api/.env
npm run db:generate
npm run db:migrate
npm run dev
```

The example URL is `postgresql://contrava:contrava@localhost:5432/contrava?connection_limit=10&pool_timeout=10`. Change local credentials as needed and never commit real secrets.

Open <http://localhost:5173>. All five applications can also be started independently:

```bash
npm run dev -w @contrava/web
npm run dev -w @contrava/api
npm run dev -w @contrava/spec-worker
npm run dev -w @contrava/scan-worker
npm run dev -w @contrava/scan-runner
```

Prisma loads `apps/api/.env`. Runtime services use the documented localhost defaults; to override them, export values from the root `.env.example` in your shell before `npm run dev`.

### Try the scan flow

1. Add a name and a reachable OpenAPI 3.x JSON/YAML URL in **Add API**.
2. Open the API and select **Scan now**, or enable automatic scanning and choose an interval.
3. Watch the persisted job move through `/jobs`; the runner creates the baseline snapshot.
4. Change the document and queue another scan to see classified changes.

Workers and the runner intentionally do not access PostgreSQL. Enqueue commits a job and outbox message together; the API publishes with confirms, and the runner manually acknowledges RabbitMQ only after the API commits a durable outcome. To test recovery locally, stop a runner during a job and start another after `JOB_LEASE_MS`; to test all retry stages and the DLQ, set `RUNNER_FAILURE_RATE=1` temporarily.

## Useful commands

```bash
npm test              # unit/component tests
npm run typecheck     # strict TypeScript checks
npm run build         # production builds
npm run lint          # ESLint checks
npm run format:check

# Destructively resets only a database whose name contains "test"
TEST_DATABASE_URL=postgresql://contrava:contrava@localhost:5432/contrava_test npm run test:postgres

# Requires an isolated test DB and reachable RabbitMQ; test topology is prefixed
TEST_DATABASE_URL=postgresql://contrava:contrava@localhost:5432/contrava_test \\
RABBITMQ_URL=amqp://guest:guest@localhost:5672 npm run test:rabbitmq

# API and RabbitMQ must be running; synthetic consumers use real broker delivery
npm run load:rabbitmq -- --jobs=1000 --runners=4 --apis=10
```

The API includes `/health`, CRUD and schedules under `/apis`, asynchronous `/apis/:id/scan`, `/jobs`, snapshot/change history, `/scans`, aggregate `/workers` health, and explicitly internal `/internal/jobs/*` runner endpoints.

## PostgreSQL operations

Prisma manages a connection pool per API process. Configure `connection_limit` and `pool_timeout` in `DATABASE_URL`; account for every API replica when budgeting PostgreSQL sessions. PgBouncer is deliberately deferred. `/health` reports database and RabbitMQ connectivity, broker latency, DLQ depth, and outbox backlog.

Completed-job retention is currently policy-only: `JOB_RETENTION_DAYS=30` documents the intended horizon, but Phase 3 does not automatically delete history. Job history is paginated with `GET /jobs?page=1&pageSize=25&status=FAILED`.

See [RabbitMQ delivery](docs/rabbitmq-delivery.md), [PostgreSQL concurrency](docs/postgres-concurrency.md), [performance](docs/performance.md), and [architecture](docs/architecture.md).

## Current limitations

RabbitMQ delivery and internal runner endpoints are intentionally unauthenticated in this learning system. `JOB_DELIVERY_MODE=postgres-polling` remains an explicit Phase 3 fallback, not the default. Scheduling supports fixed intervals rather than cron, automated retention is not enabled, and OpenAPI `$ref` handling is limited to local document references.
