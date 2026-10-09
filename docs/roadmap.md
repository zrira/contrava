# Roadmap

## Completed

### Phase 1 — contract monitoring foundation

React/NestJS/Express services, SQLite snapshots, deterministic OpenAPI fetching and diffing, manual orchestration, bounded HTTP retries, correlation IDs, health checks, and tests.

### Phase 2 — scheduling and background jobs

Per-API intervals, a NestJS scheduler, persisted scan jobs, a separately runnable scan-runner, conditional lease claims, heartbeats, durable retry scheduling, concurrency limits, crash recovery, job health, and queue visibility. Manual scans now use the same background path.

### Phase 3 — PostgreSQL concurrency

PostgreSQL is now the primary database. Native UUIDs, JSONB, timestamptz values, and lifecycle enums strengthen the schema. Queue consumers batch claim with `FOR UPDATE SKIP LOCKED`; scheduler rows and snapshot baselines use short row locks; stale owners are checked by runner ID and token. Integration stress tests, query-plan review, pool configuration, pagination, queue metrics, and load tooling are included.

### Phase 4 — RabbitMQ delivery

RabbitMQ now provides push delivery while PostgreSQL remains authoritative. Transactional outbox publication uses publisher confirms; runners use bounded prefetch and manual acknowledgements. Delayed retry queues provide 5/15/60-second stages, terminal/poison messages enter a DLQ, and claim-by-ID plus leases make duplicate and crash recovery idempotent. Broker health, outbox/DLQ metrics, integration tests, and RabbitMQ load tooling are included.

## Phase 5 — GitHub integration

Connect repositories and map breaking endpoints to affected files, hooks, and pages. Keep repository analysis separate from deterministic contract diffing.

## Phase 6 — AI impact analysis

Introduce Python/FastAPI to explain impact and migration approaches. AI may explain deterministic output, but must not decide whether an OpenAPI change exists.

## Phase 7 — automated fixes

Generate reviewable migration patches, run tests, and eventually open pull requests with a human approval boundary.

## Phase 8 — observability

Add OpenTelemetry, Prometheus, and Grafana for traces, metrics, latency, saturation, retry rates, lease recovery, and structured-log exploration.

## Phase 9 — multi-tenancy and SaaS

After the workflow proves useful, add users, organizations, projects, authentication, authorization, usage limits, and subscriptions.

## Deliberately deferred

Redis, BullMQ, Kafka, Docker, Kubernetes, authentication, payments, service meshes, GraphQL, WebSockets, CQRS, event sourcing, GitHub access, AI, and cloud deployment remain outside Phase 4. RabbitMQ is used only for Phase 4 job delivery; PostgreSQL remains the business-state source of truth.
