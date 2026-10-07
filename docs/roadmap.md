# Roadmap

## Completed

### Phase 1 — contract monitoring foundation

React/NestJS/Express services, SQLite snapshots, deterministic OpenAPI fetching and diffing, manual orchestration, bounded HTTP retries, correlation IDs, health checks, and tests.

### Phase 2 — scheduling and background jobs

Per-API intervals, a NestJS scheduler, persisted scan jobs, a separately runnable scan-runner, conditional lease claims, heartbeats, durable retry scheduling, concurrency limits, crash recovery, job health, and queue visibility. Manual scans now use the same background path.

## Phase 3 — PostgreSQL

Replace SQLite and study concurrent writers, transaction isolation, indexing, migration operations, and connection pooling. Revisit claim query behavior under real row locking.

## Phase 4 — queues

Replace database polling where appropriate with Redis/BullMQ or RabbitMQ. Study broker acknowledgements, delayed retries, dead-letter queues, idempotent consumers, and at-least-once delivery.

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

PostgreSQL, Redis, BullMQ, RabbitMQ, Kafka, Docker, Kubernetes, authentication, payments, service meshes, GraphQL, WebSockets, CQRS, event sourcing, GitHub access, AI, and cloud deployment remain outside Phase 2.
