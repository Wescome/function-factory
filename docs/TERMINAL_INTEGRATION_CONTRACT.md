# Function Factory Terminal Integration Contract

Status: draft source of truth for the Function Factory Terminal implementation.

This contract aligns the Function Factory Terminal fork with the current `Wescome/function-factory` repository. The terminal implementation must treat this repository as the domain source of truth.

## Canonical Repo

Canonical Function Factory repo:

```text
Wescome/function-factory
```

Local development path:

```text
/Users/wes/Developer/function-factory
```

The terminal must not hard-code this path. It must read the repo path from configuration:

```text
ff:repopath
```

## Artifact Storage

Factory artifacts live under:

```text
specs/
```

The terminal must support both:

- YAML artifacts: `specs/**/*.yaml`
- Markdown PRDs and reference documents: `specs/**/*.md`

PRDs are currently Markdown:

```text
specs/prds/PRD-*.md
```

Most other Factory artifacts are YAML.

## Artifact Identity

Artifact IDs are canonicalized by `packages/schemas/src/lineage.ts`.

The terminal must not maintain its own independent artifact prefix list. It may cache a local prefix map for UI purposes, but the schema file remains the source of truth.

Required behavior:

- Parse artifact IDs from the `id` field when present.
- Fall back to filename stem when reading Markdown PRDs.
- Infer artifact type from ID prefix.
- Treat artifact IDs as globally unique within a configured Function Factory repo.

## Lineage Field

The canonical lineage field is:

```text
source_refs
```

The local reader may tolerate `sourceRefs` as a compatibility fallback, but emitted Factory artifacts must use `source_refs`.

## Local Mode

Local mode is the Phase 1/2 operating mode. It requires no gateway.

Required local capabilities:

- Resolve an artifact ID to a file under `specs/`.
- Read YAML artifacts into generic JSON-like maps.
- Read Markdown PRDs into an envelope with metadata and raw Markdown content.
- Traverse `source_refs` upstream and downstream.
- Build a lineage graph from local files.

## Gateway Mode

Gateway mode uses the existing Cloudflare Worker gateway.

Current gateway routes include:

```text
GET  /health
GET  /specs/:collection/:key
GET  /specs/:collection
GET  /lineage/:collection/:key
GET  /impact/:collection/:key
POST /gate/1
GET  /gate-status/:gate/:id
GET  /trust/:id
GET  /crps/pending
GET  /mrps/pending
POST /pipeline
POST /approve/:id
GET  /pipeline/:id
```

The terminal must adapt to this contract instead of assuming an unimplemented gateway API.

## Pipeline Monitoring

The first implementation must use polling:

```text
GET /pipeline/:id
```

WebSocket streaming can be added later if the gateway exposes a stable streaming endpoint.

## Compile Request

The current gateway starts a pipeline with:

```text
POST /pipeline
```

The request body requires a `signal` object and optional `dryRun`.

Terminal UX may accept `ff compile <prd-id>`, but the backend adapter must translate that into the current gateway request format or fail with a clear unsupported-mode error.

## Config Keys

Minimum terminal config keys:

```text
ff:repopath
ff:gatewayurl
ff:gatewayauth
ff:defaulttab
```

Secrets must be environment variables initially. `ff:gatewayauth` should support env references such as:

```text
$ENV:FF_GATEWAY_AUTH
```

## Phase 1 Acceptance

The first useful terminal vertical slice is local only:

- `ff inspect PRD-META-COMPILER-PASS-8`
- `ff trace PRD-META-COMPILER-PASS-8`

Both commands must work against the canonical `specs/` directory without requiring the gateway.

