# Deterministic repository impact analysis

Phase 5 answers “which indexed call sites are likely affected?” without AI, embeddings, runtime tracing, or opaque scoring.

## Extraction pipeline

```text
GitHub blob at pinned commit
  → UTF-8 JS/TS source
  → TypeScript compiler AST
  → ApiUsageCandidate[]
  → normalized operation association
  → PostgreSQL ApiUsage
```

The TypeScript compiler API handles JavaScript, JSX, TypeScript, and TSX with one parser and reliable source positions. AST walking naturally ignores comments and strings that are not call expressions. Extraction is persistence-independent in `@contrava/repo-scanner` and can run against fixture directories or future source providers.

Recognized Phase 5 forms include:

```ts
fetch('/users/123')
fetch(`${baseUrl}/users/${id}`)
axios.get('/users/' + id)
axios({ method: 'POST', url: '/users' })
apiClient.request({ method: 'GET', url: '/users/' + id })
userClient.get(`/users/${id}`)
```

Direct `fetch`, axios, request-config objects, and client/wrapper methods are explicit match types. Constant string base URLs in a source file are resolved. Fully dynamic identifiers are intentionally ignored rather than guessed.

## Endpoint normalization

Normalization:

- strips `http(s)://host`, query strings, fragments, duplicate/trailing slashes;
- uppercases methods;
- converts OpenAPI `{id}`, template substitutions, concatenated unknown expressions, numeric IDs, and UUID-like path segments to `{param}`;
- compares equal-length segments with `{param}` as a wildcard;
- does not require source/OpenAPI parameter names to agree.

Examples:

```text
/users/123                → /users/{param}
/users/${id}              → /users/{param}
'/users/' + id            → /users/{param}
/users/{id}               → /users/{param}
https://host/users/1?q=x  → /users/{param}
```

## Match types and evidence

`ApiUsage.matchType` is one of `STATIC_LITERAL`, `TEMPLATE_LITERAL`, `STRING_CONCATENATION`, `HTTP_CLIENT_CALL`, `BASE_URL_JOIN`, `WRAPPER_CALL`, or `UNKNOWN`. Evidence stores the call form, bounded original expression, normalized path, method derivation, and scanner version. The source snippet is bounded and source files are not stored.

Canonical usage rows have `apiId=null`. After a repository is linked or indexed, NestJS deterministically associates canonical rows with each linked API’s latest OpenAPI operations. This preserves provider-independent extraction while making API filtering and impact queries efficient.

## Confidence rules

- **HIGH:** explicit/default-deterministic method plus an exact normalized operation match from a direct HTTP client call.
- **MEDIUM:** wrapper semantics are inferred, or an exact endpoint is affected by a request/response/property/type change where value-level flow is not proven.
- **LOW:** reserved for bounded partial evidence; Phase 5 prefers omitting fully dynamic URLs over manufacturing low-confidence matches.

Confidence is an enum, never an unexplained model score.

## Change-to-usage rules

`impactAlgorithmVersion="1"` is persisted on findings.

| API change | Finding rule |
| --- | --- |
| Endpoint removed | matching path/method call site; HIGH unless usage extraction was less certain |
| Method removed | matching path and method; HIGH unless usage extraction was less certain |
| Required request property/parameter added | matching operation; MEDIUM, request construction not traced |
| Request type/constraint changed | matching operation; MEDIUM |
| Response property/type/success response removed | matching operation; MEDIUM, response field flow not proven |
| Other breaking/potentially breaking change | matching operation; MEDIUM with bounded-certainty reason |
| Non-breaking change | no finding |

Findings are generated when API changes are committed. Repository re-indexing, API linking, or a new OpenAPI baseline also rebuilds associations and findings, so ordering those user actions does not lose impact.

## Blast radius and freshness

The impact endpoint groups findings into affected repositories, files, call sites, and HIGH/MEDIUM/LOW counts. Every finding includes repository, path, line, snippet, match type, evidence, indexed commit, and reason. The UI flags a finding whenever repository `headCommitSha` differs from its `indexedCommitSha`.

## Known false positives and negatives

Expected false positives:

- a client-like object name may not actually perform HTTP;
- numeric static path segments are treated as identifiers;
- an endpoint call may not consume the particular changed response field;
- dead code still represented as a real call expression can be indexed.

Expected false negatives:

- URLs assembled across functions/modules or derived entirely at runtime;
- wrappers whose names do not resemble HTTP clients;
- aliases and complex object spreads in request config;
- generated clients excluded by source filters;
- response-field use requiring dataflow/interprocedural analysis.

There is no runtime tracing, full symbol/type resolution, cross-file constant propagation, field-level response proof, or non-JS/TS language support. Phase 6 may add explanations, but deterministic evidence remains the baseline and must not be replaced by AI inference.
