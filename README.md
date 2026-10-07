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
| `@contrava/scan-runner` | 3003 | Poll, lease, heartbeat, and execute persisted jobs |

## Prerequisites

- Node.js 20 or newer
- npm 10 or newer

## Local development

```bash
npm install
cp apps/api/.env.example apps/api/.env
npm run db:generate
npm run db:migrate
npm run dev
```

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

Workers and the runner intentionally do not access SQLite. The runner uses the API's internal job protocol. To test recovery locally, stop a runner during a job and start another after `JOB_LEASE_MS`; to test retries, set `RUNNER_FAILURE_RATE=1` temporarily.

## Useful commands

```bash
npm test            # all unit/component tests
npm run typecheck   # strict TypeScript checks
npm run build       # production builds
npm run lint        # ESLint checks
npm run format:check
```

The API includes `/health`, CRUD and schedules under `/apis`, asynchronous `/apis/:id/scan`, `/jobs`, snapshot/change history, `/scans`, aggregate `/workers` health, and explicitly internal `/internal/jobs/*` runner endpoints.

## Current limitations

This phase uses a polling SQLite-backed job table, not a production message broker. Internal runner endpoints are intentionally unauthenticated for local learning. SQLite limits control-plane write concurrency, scheduling supports fixed intervals rather than cron, and OpenAPI `$ref` handling is limited to local document references. See [architecture](docs/architecture.md) and [roadmap](docs/roadmap.md).
