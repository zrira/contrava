# GitHub repository integration

## Authentication strategy

Phase 5 supports public GitHub API access and a fine-grained personal access token supplied only through `GITHUB_TOKEN` on `repo-scan-runner`. No token, Authorization header, private key, or installation token is sent to the browser, persisted in PostgreSQL, included in a URL, or intentionally logged. Structured logging redacts token/authorization-like field names.

A fine-grained PAT is the lowest-ceremony development mode. Limit it to the repositories and read-only **Contents** and **Metadata** permissions that Contrava needs. GitHub Apps are preferable for a multi-user deployment because installation access is scoped and short-lived. The repository model already has `installationId`, and GitHub access is isolated behind `GitHubClient`, so installation-token generation can replace PAT headers without changing the scanner. GitHub App setup/private-key custody is deliberately deferred.

## Commit-pinned fetch flow

The worker uses GitHub REST tree/blob APIs, not `git clone` or archive extraction:

1. read repository metadata;
2. resolve the selected/default branch through the commits API;
3. persist the exact 40-character commit SHA on `RepositoryScan` and `Repository.headCommitSha`;
4. enumerate a recursive tree or compare the previous and current SHAs;
5. fetch only supported blobs by SHA;
6. submit a bounded index result to NestJS.

Persisting the SHA before blob retrieval makes retries reproducible. GitHub tree/blob APIs avoid requiring Git and eliminate archive traversal, archive-bomb, temporary-directory, and symlink-extraction risks. Tree entries with absolute paths, backslashes, NULs, `..`, symlink modes, or submodule types are never scanned.

## Incremental indexing

When `lastIndexedCommitSha` exists, the worker asks GitHub to compare it with the newly resolved SHA. Added/modified/renamed supported files are downloaded and reparsed; deleted and renamed-away paths are removed; unchanged files and usages remain untouched. The worker falls back to a full recursive tree when compare history is unavailable or GitHub returns an incomplete large comparison. Correctness wins over avoiding work.

A full completion removes indexed source files absent from the pinned tree. An incremental completion changes only reported paths. File content hashes are SHA-256 values. `scannerVersion="1"` is persisted on every scan so future extraction-rule changes can trigger explicit re-indexing.

## Supported source and limits

Phase 5 scans `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, and `.cjs`. It ignores dependency/output/generated directories, lockfiles, generated files, minified bundles, unsupported extensions, symlinks, submodules, and binary content.

Defaults:

```text
REPO_MAX_FILES=5000
REPO_MAX_FILE_BYTES=524288
REPO_MAX_TOTAL_BYTES=52428800
REPO_SCAN_CONCURRENCY=4
REPO_SCAN_PREFETCH=1
GITHUB_MAX_RESPONSE_BYTES=10485760
```

Limits are checked against tree metadata and downloaded bytes. NestJS independently validates paths, hashes, candidate shapes, snippet lengths, file counts, and a 100,000-usage ceiling. API JSON bodies default to 10 MB. Source bodies are not persisted; snippets are at most five lines and 1,200 characters.

## Failure and rate-limit behavior

- network timeout, HTTP 408/429/5xx: retryable;
- primary/secondary GitHub rate limit: retryable at the reported reset or Retry-After time;
- HTTP 401/403 authentication failure: terminal;
- HTTP 404 repository/object missing: terminal;
- unsafe path, truncated tree, hard size limit, unsupported blob encoding: terminal;
- incomplete compare: safe full-scan fallback.

Transient retries use durable 15-second, 60-second, and 300-second RabbitMQ retry queues. Rate-limited scans use an outbox `availableAt` equal to reset time, preventing busy API calls. Errors and reset timestamps are persisted on `RepositoryScan`.

## Manual operation and freshness

Repository indexing is manual through `POST /repositories/:id/scan` or **Re-index repository**. A per-repository active key coalesces concurrent requests. Push webhooks are future work.

`lastIndexedCommitSha` identifies the code used for current findings. `headCommitSha` is the latest head resolved by a scan attempt. If resolution reaches commit B but indexing fails while the valid index remains at A, API and repository pages display that findings are based on A rather than silently claiming freshness.

## Optional live tests

Normal tests use deterministic local fixtures and mocked GitHub responses. Live GitHub tests are intentionally not required. Manual live validation can use a public repository without `GITHUB_TOKEN`, or a narrowly scoped token for a private repository.
