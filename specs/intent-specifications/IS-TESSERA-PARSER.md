---
id: IS-TESSERA-PARSER
version: 2
title: "Tessera Parser — tree-sitter-wasm symbol extraction for TypeScript and Go"
sourceCapabilityId: BC-TESSERA-PARSER
sourceFunctionId: FP-TESSERA-PARSER
source_refs:
  - TESSERA-CF-SPEC
explicitness: explicit
rationale: >
  TESSERA-CF-SPEC §4.3 (WP-T2) requires porting Tessera's `LanguageProvider`
  from the native tree-sitter binding to **tree-sitter-wasm**, because native
  tree-sitter dlopens `.node`/`.so` and cannot run on Cloudflare Workers (H5,
  §6.1). The WASM provider has a fundamentally different async API
  (`await Parser.init()`, `Parser.Language.load(<wasm>)`) than the synchronous
  native binding. This IS isolates the parse layer as a **pure function**: source
  content + language → typed symbol array, with no I/O, no database, no HTTP.

  Isolating parsing as a pure function makes the parity gate (G4, AC-PARSE-1)
  directly testable — the WASM extraction must match the native CLI extraction
  for the same file, modulo the source-body content column (G5: bodies live in
  R2, never on nodes). The indexer (IS-TESSERA-INDEXER) composes this function
  over every source file in a repo tarball.

  v2 (2026-06-01): P0 TEST SEAM GAP identified. On 2026-06-01 a coding agent
  changed the call path away from a Go package-level function variable
  (`workflowServeList`) without knowing 12+ tests override it as a seam.
  `tessera_impact("workflowServeList")` returned UNKNOWN because package-level
  function variables are not indexed as graph nodes — only functions, methods,
  structs, and interfaces are. The pre-edit gate (IS-TESSERA-PRE-EDIT-GATE)
  has a blind spot on any Go test seam declared as `var f = someFunc`. This IS
  v2 adds `FunctionVariable` extraction for Go to close that blind spot.
---

# Tessera Parser (WP-T2 parse layer)

## JTBD

When the indexer has the text of a source file and knows its language, it wants
a typed list of the code symbols that file defines — functions, classes,
interfaces, structs, methods — with their names and line ranges, so that it can
build graph nodes without the parser touching the database, the network, or the
filesystem.

## Problem

Tessera's existing parser uses the **native** tree-sitter binding, which loads a
`.node` shared library. Cloudflare Workers cannot dlopen native code (H5,
TESSERA-CF-SPEC §6.1). The native binding is synchronous; the WASM binding
(`web-tree-sitter`) is **async** with a different API surface:
`await Parser.init()` before any use, and `Parser.Language.load(<wasm bytes>)`
to load each grammar — versus the native binding's synchronous
`new Parser(); parser.setLanguage(require('tree-sitter-go'))`.

Without this port:
- The indexer cannot extract symbols inside a Worker.
- The entire cloud Tessera graph cannot be built.

A second risk: parity. If the WASM grammars extract a different node/edge set
than the native CLI for the same file, every downstream impact/context result is
silently corrupted (G4). The parser must be a pure, deterministic function so the
parity gate is a clean unit test.

A third risk (v2): **Go test seam blind spot.** Go codebases routinely declare
package-level function variables as test seams:

```go
var workflowServeList = nextWorkflowServeBeads  // overridden in tests
var controlDispatcherServe = runControlDispatcherInStore
```

These are the most dangerous symbols to change — touching the call path away
from them silently breaks every test that overrides them — yet the v1 parser
ignores them entirely. A `var` assigned a function value is not a function
declaration, so tree-sitter's Go grammar does not produce a `function_declaration`
or `method_declaration` node for it. Without explicit extraction, every Go test
seam is invisible to impact analysis and the pre-edit gate (IS-TESSERA-PRE-EDIT-GATE).

This is what happened on 2026-06-01: `workflowServeList` was invisible to
Tessera. `tessera_impact("workflowServeList")` returned UNKNOWN. The gate had
no data. The agent proceeded blind and broke 12 tests.

## Goal

Implement `parse` in `workers/tessera-worker/src/parser.ts` as a pure function:

```typescript
parse(content: string, language: 'typescript' | 'go', filePath: string): ParsedSymbol[]
```

returning typed `ParsedSymbol` objects:

```typescript
interface ParsedSymbol {
  uid: string          // stable, deterministic id for the symbol
  name: string         // symbol name
  kind: string         // Function | Class | Interface | Method | Struct | ...
  filePath: string     // the filePath argument, unchanged
  startLine: number     // 1-based, inclusive
  endLine: number       // 1-based, inclusive
  properties: Record<string, unknown>  // language/kind-specific extras
}
```

1. Use the **`web-tree-sitter` async API** (`await Parser.init()`,
   `Parser.Language.load()`) — NOT the native `tree-sitter` binding (H5).
2. Load grammars from the R2 binding `GRAMMARS` at Worker startup; `parse` itself
   consumes already-loaded `Language` objects (it stays pure — grammar loading is
   a one-time startup concern, not per-call I/O).
3. Support TypeScript (covers `.ts`, `.tsx`) and Go (covers `.go`).
4. Skip binary files, files over 512KB, and generated files (`*.gen.ts`,
   `*.pb.go`) — return `[]`.
5. Store `startLine`/`endLine` only; **never** the source body (G5 — bodies live
   in R2).

`parse` performs no I/O: no `fetch`, no database call, no filesystem access.

## Scope

**In scope:**
- `workers/tessera-worker/src/parser.ts` — new file: `parse(...)`, the
  `ParsedSymbol` type, the grammar-loading startup helper, and the skip rules.
- TypeScript extraction: Function, Class, Interface, Method (and their `.ts`/`.tsx` coverage).
- Go extraction: Function, Struct, Interface, Method (and `.go` coverage).
- **Go `FunctionVariable` extraction (v2, P0):** package-level `var` declarations
  assigned function-typed values — `var f = someFunc` or `var f func(...) = ...`.
  Extracted as `kind: "FunctionVariable"`, indexed as graph nodes, participates
  in impact analysis.
- Deterministic `uid` derivation per symbol.
- Skip logic: binary, >512KB, `*.gen.ts`, `*.pb.go`.

**Out of scope:**
- Cross-file relation resolution (IMPORTS, CALLS, EXTENDS, IMPLEMENTS) — that
  needs the full symbol table across all files (IS-TESSERA-INDEXER, §4.3).
  `parse` emits **symbols (nodes) only**, plus any **intra-file** structural
  signal needed for the indexer (e.g. which class a method belongs to) carried
  in `properties` — but NOT resolved cross-file edges.
- Fetching tarballs / reading files (IS-TESSERA-INDEXER).
- Loading grammar bytes from R2 is a startup concern; the per-call `parse`
  function takes loaded `Language` objects and does no R2 I/O.
- Community detection, process detection (V2, §4.3).
- Languages beyond TypeScript and Go (additional `LanguageProvider`s are future
  work; the shared core must stay language-agnostic per the CLAUDE.md contract).
- Storing source bodies on symbols (forbidden by G5).

## Acceptance Criteria

### Parse correctness (AC-P*)

**AC-P1.** `parse('function foo(x: string): number { return 1; }', 'typescript',
'a.ts')` returns exactly one `ParsedSymbol` with `kind === 'Function'`,
`name === 'foo'`, `startLine === 1`, and an `endLine` covering the function body.

**AC-P2.** `parse('type T = {}\nclass Bar { baz() {} }', 'typescript', 'b.ts')`
returns a `Class` symbol named `Bar` and a `Method` symbol named `baz`; the
method carries, in `properties`, the owning class name `Bar` (intra-file
structural signal, for the indexer's HAS_METHOD edge — but `parse` does not emit
the edge itself).

**AC-P3.** `parse('interface Greeter { greet(): string }', 'typescript', 'c.ts')`
returns an `Interface` symbol named `Greeter`.

**AC-P4.** `parse('type User struct { Name string }', 'go', 'd.go')` returns a
`Struct` symbol named `User`. (Go struct → `Struct` kind, per GT-SCHEMA's
multi-language kinds.)

**AC-P5.** `parse('func Add(a, b int) int { return a + b }', 'go', 'e.go')`
returns a `Function` symbol named `Add`. A Go method with a receiver
(`func (u *User) Name() string {}`) returns a `Method` symbol named `Name` whose
`properties` records the receiver type `User`.

**AC-P6-GO-VAR (v2, P0 — test seam extraction).** A Go source file containing
a package-level `var` assigned a function value is extracted as a
`FunctionVariable` node:

```go
// input
var workflowServeList = nextWorkflowServeBeads
var providerLifecycleContext = func(parent context.Context, d time.Duration) (context.Context, context.CancelFunc) {
    return context.WithTimeout(parent, d)
}
```

`parse(content, 'go', 'dispatch_runtime.go')` returns:
- `{ kind: 'FunctionVariable', name: 'workflowServeList', startLine: N, endLine: N }`
- `{ kind: 'FunctionVariable', name: 'providerLifecycleContext', startLine: M, endLine: M+3 }`

Both are indexed as graph nodes with the same `uid` derivation as functions.

**AC-P6-GO-VAR-2.** `FunctionVariable` nodes participate in cross-file edge
resolution (IS-TESSERA-INDEXER Phase 2). A call site that references
`workflowServeList(...)` produces a `CALLS` edge to the `FunctionVariable` node,
exactly as it would to a `Function` node. This is the property that makes
`tessera_impact("workflowServeList")` return callers instead of UNKNOWN.

**AC-P6-GO-VAR-3 (reference case).** After indexing gascity with v2 parser:
`tessera_impact("workflowServeList", direction: "upstream", repo: "gascity")`
returns at minimum `drainWorkflowServeWork` as a d=1 caller, and
`runWorkflowServe` + `runWorkflowServeFollow` at d=2. The pre-edit gate returns
STOP for this symbol. This is the 2026-06-01 incident acceptance fixture.

**AC-P6-GO-VAR-SCOPE.** Only **package-level** `var` declarations with
function-typed values are extracted. Local variables inside function bodies are
NOT extracted (they are ephemeral, not test seams). The distinction: top-level
`var` = package-level = test seam candidate; inner `var` = local = skip.

**AC-P7.** Every returned `ParsedSymbol` has `filePath` equal to the `filePath`
argument, unchanged.

**AC-P7.** `startLine` and `endLine` are 1-based and inclusive;
`endLine >= startLine` for every symbol. No symbol carries a source body, raw
text, or `content` field (G5).

### uid determinism (AC-U*)

**AC-U1.** `uid` is deterministic: parsing the same `(content, language,
filePath)` twice yields byte-identical `uid` values for every symbol.

**AC-U2.** `uid` is stable across symbols of the same name in different files:
two `foo` functions in `a.ts` and `b.ts` get distinct `uid`s (uid incorporates
`filePath`). Two distinct symbols in the **same** file with the same name but
different line ranges (rare, e.g. overloads) get distinct `uid`s (uid
incorporates position or an in-file ordinal). Document the exact derivation.

### Async API (AC-A*)

**AC-A1.** Grammar loading uses the `web-tree-sitter` async API:
`await Parser.init()` is called once at Worker startup, and each grammar is
loaded via `Parser.Language.load(<wasm bytes from R2 GRAMMARS>)` (H5). The
implementation MUST NOT import the native `tree-sitter`, `tree-sitter-go`, or
`tree-sitter-typescript` node packages (they dlopen native code and cannot run
on Workers).

**AC-A2.** The TypeScript grammar covers both `.ts` and `.tsx` files; the Go
grammar covers `.go`. Language is selected by the `language` argument, not by
re-deriving it inside `parse` (the indexer maps extension → language and passes
it in).

**AC-A3.** `parse` is synchronous-pure with respect to I/O: given already-loaded
`Language` objects, it issues no `fetch`, no R2 read, no DB call. (The function
may itself be `async` if the WASM API requires it, but it performs no I/O — the
only async surface is grammar init at startup.)

### Skip rules (AC-SK*)

**AC-SK1.** A file whose byte length exceeds **512KB** returns `[]` without
parsing.

**AC-SK2.** A binary / non-source file (detected by null-byte heuristic or by the
indexer's extension allowlist before calling `parse`) returns `[]`. `parse`
itself returns `[]` for content it cannot tokenize as the given language rather
than throwing.

**AC-SK3.** Generated files return `[]`: any `filePath` matching `*.gen.ts` or
`*.pb.go` is skipped. The skip is by `filePath` pattern, evaluated before
parsing.

**AC-SK4.** A skipped file produces no symbols and no error — `[]` is returned,
the indexer continues to the next file.

### Purity (AC-PURE*)

**AC-PURE1.** `parse` makes zero network calls, zero database calls, and zero
filesystem reads. Forbidden references inside `parser.ts`'s `parse` body:
`fetch`, any `arango`/`db` handle, R2 binding access, `INDEX_QUEUE`. (Grammar
init at startup may read R2 `GRAMMARS`; that is outside the `parse` function.)

**AC-PURE2.** `parse` is deterministic: identical inputs always produce an
identical `ParsedSymbol[]` (same order, same uids, same lines). No timestamps,
no randomness in the output.

## Environment dependencies

| Binding / Env | wrangler.jsonc | Purpose |
|---------------|----------------|---------|
| `GRAMMARS` | r2_bucket | tree-sitter WASM grammars (`tree-sitter-typescript.wasm`, `tree-sitter-go.wasm`) loaded at Worker startup via `Parser.Language.load` |

`GRAMMARS` is read only at startup to construct `Language` objects, not inside
`parse`. The WASM grammar binaries are uploaded to the `tessera-grammars` R2
bucket out of band (deploy-time asset, not a runtime concern of this IS).

## Non-negotiables

- Uses the `web-tree-sitter` **async** API; never imports native `tree-sitter`
  packages (AC-A1, H5).
- `parse` is a **pure function** — no I/O, deterministic output (AC-PURE1,
  AC-PURE2).
- No source body / `content` field on any `ParsedSymbol` (G5 — bodies live in
  R2; nodes carry only `startLine`/`endLine`).
- 512KB cap, binary skip, and generated-file skip (`*.gen.ts`, `*.pb.go`) all
  return `[]` (AC-SK1–3).
- `parse` emits **nodes only** — cross-file edge resolution is the indexer's job
  (out of scope).
- The shared ingestion core must remain language-agnostic; language specifics
  live behind the `LanguageProvider` boundary (CLAUDE.md / AGENTS.md contract).

## Success Metrics

`parse(content, language, filePath)` returns a typed `ParsedSymbol[]` for
TypeScript and Go source: a TS function yields a `Function` symbol with the
correct name and line range; a TS class with a method yields `Class` + `Method`
with the method's owning class captured in `properties`; a Go struct yields a
`Struct` symbol; a Go method with a receiver yields a `Method` symbol. Every
symbol carries the unchanged `filePath` and a 1-based inclusive line range, and
no symbol carries a source body.

The parser runs entirely on Workers: it uses the `web-tree-sitter` async API and
loads TS + Go grammars from R2 at startup, never the native binding. The `parse`
function itself is pure — no network, no database, no filesystem — and
deterministic, so the WP-T2 parity gate (AC-PARSE-1, G4) is a clean unit test
comparing WASM extraction against the native CLI for the same file.

Skip rules hold: a >512KB file, a binary file, and a generated file
(`*.gen.ts` / `*.pb.go`) each return `[]` without throwing, so the indexer can
walk an entire repo tarball without special-casing oversized or generated
content.

**v2 test seam closure:** Go package-level function variables (`FunctionVariable`
kind) are extracted and indexed as graph nodes. `tessera_impact("workflowServeList")`
on gascity returns `drainWorkflowServeWork` as a d=1 caller. The 2026-06-01
incident — 45 minutes of regressions from a single missed blast-radius check —
cannot recur once the v2 parser and pre-edit gate (IS-TESSERA-PRE-EDIT-GATE)
are deployed together.
