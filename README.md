# Contrava

**Contrava — API contracts that watch themselves.**

Contrava monitors OpenAPI contracts and reports breaking changes before they surprise production consumers. This first usable phase registers APIs, stores snapshots, compares changed specifications, classifies changes, and displays the history.

## Services

| Service | Port | Purpose |
| --- | ---: | --- |
| `@contrava/web` | 5173 | React control UI |
| `@contrava/api` | 3000 | NestJS API, persistence, and scan orchestration |
| `@contrava/spec-worker` | 3001 | Fetch, parse, normalize, and hash OpenAPI documents |
| `@contrava/scan-worker` | 3002 | Deterministic OpenAPI contract diffing |

## Prerequisites

- Node.js 20 or newer
- npm 10 or newer

## Local development

```bash
npm install
cp .env.example .env
npm run db:generate
npm run db:migrate
npm run dev
```

Accept Prisma's migration name prompt if requested (for example, `init`). Open <http://localhost:5173>. All four applications can also be started independently:

```bash
npm run dev -w @contrava/web
npm run dev -w @contrava/api
npm run dev -w @contrava/spec-worker
npm run dev -w @contrava/scan-worker
```

Environment variables from `.env` are not automatically loaded by every process. Export them in your shell, use a tool such as `dotenvx`, or rely on the documented localhost defaults. Prisma reads `apps/api/.env` as well; for the default database, create it with:

```bash
printf 'DATABASE_URL="file:./dev.db"\n' > apps/api/.env
npm run db:migrate
```

### Try the scan flow

1. Add a name and a publicly reachable OpenAPI 3.x JSON/YAML URL in **Add API**.
2. Open the API and select **Run scan** to establish its baseline.
3. Change the document served at that URL (or update the tracked URL with `PATCH /apis/:id`).
4. Run another scan and view the timeline or **Change history**.

Workers intentionally do not access SQLite. They receive documents through HTTP and return deterministic results.

## Useful commands

```bash
npm test            # all unit/component tests
npm run typecheck   # strict TypeScript checks
npm run build       # production builds
npm run lint        # ESLint checks
npm run format:check
```

The API endpoints are documented by the code and include `/health`, CRUD under `/apis`, `/apis/:id/scan`, snapshot/change history, `/scans`, and aggregate `/workers` health.

## Current limitations

This phase uses synchronous scan requests and a single SQLite control-plane database. It has no authentication, scheduler, queue, or cloud deployment. OpenAPI `$ref` handling in the diff worker is limited to local document references. See [architecture](docs/architecture.md) and [roadmap](docs/roadmap.md).
