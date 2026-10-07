# Roadmap

The current release is **Phase 1**: manual registration, fetching, snapshots, deterministic diffing, classification, history, retries, health checks, and correlation IDs.

## Phase 2 — scheduling

Add scan intervals, policies, a scheduler, and background jobs. Keep manual scans available.

## Phase 3 — PostgreSQL

Replace SQLite and study concurrent writers, transactions, indexing, migration operations, and connection pooling.

## Phase 4 — queues

Move suitable synchronous dispatch to Redis with BullMQ or RabbitMQ. Study acknowledgements, retries, dead-letter queues, idempotent consumers, and at-least-once delivery.

## Phase 5 — GitHub integration

Connect repositories and map breaking endpoints to affected files, hooks, and pages. Do not mix repository analysis into deterministic contract diffing.

## Phase 6 — AI impact analysis

Introduce a Python/FastAPI service to explain impact and migration approaches. AI may explain deterministic output, but must not decide whether an OpenAPI change exists.

## Phase 7 — automated fixes

Generate reviewable migration patches, run tests, and eventually open pull requests. Preserve a human approval boundary.

## Phase 8 — observability

Add OpenTelemetry, Prometheus, and Grafana for distributed traces, metrics, latency, error rates, and structured-log exploration.

## Phase 9 — multi-tenancy and SaaS

After the core workflow proves useful, add users, organizations, projects, authentication, authorization, usage limits, and subscriptions.

## Deliberately deferred

Authentication, payments, Kafka, Kubernetes, service meshes, GraphQL, WebSockets, event sourcing, CQRS, AI fixes, GitHub access, and cloud deployment are outside phase one.
