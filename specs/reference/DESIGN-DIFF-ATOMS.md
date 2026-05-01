# DESIGN: Diff-Based Atom Code Generation

**Status:** APPROVED WITH CONDITIONS (all resolved below)  
**Architecture Decision:** 2026-05-01 (Wes cleared gate)  
**Architect Review:** 2026-05-01 — APPROVED  
**Approach:** Diff-based atoms with regex structural extraction + compile gate  

## JTBD

When an atom needs to modify existing code, I want it to see the current file
state and produce a targeted diff, so the Factory never produces destructive
overwrites and synthesis output is safe to merge.

## Problem Statement

The CoderAgent produces `CodeArtifact.files[].content` as complete file
contents. `generate-pr.ts` commits this via GitHub PUT `/contents/{path}`,
which replaces the entire file. The LLM never sees the existing file — it
synthesizes from specification alone.

**Result:** Every "modify" atom overwrites the target file. PRs #45 and #46
deleted 1,489 and 110 lines of production code respectively.

## Design

### 1. File Context Injection (Pre-Atom)

When an atom targets an existing file (action = "modify"):

```
AtomExecutor → GitHub GET /contents/{path} → base64 decode → inject into CoderAgent prompt
```

For TypeScript files, also provide structural context via tree-sitter:
- Exported symbols (functions, types, classes)
- Import map
- The specific function/type the atom targets (if derivable from atom spec)

This keeps the LLM grounded in reality — it sees what exists before proposing changes.

### 2. CodeArtifact Schema v2

```typescript
interface FileChange {
  path: string;
  action: 'create' | 'modify' | 'delete';
  // For action='create': full file content
  content?: string;
  // For action='modify': array of search/replace operations
  edits?: Edit[];
}

interface Edit {
  // Exact string to find in existing file (must be unique, min 10 chars)
  search: string;
  // Replacement string (applied sequentially — each edit sees post-prior-edit text)
  replace: string;
  // Optional: if search matches multiple times, prefer match within this function/class
  scope?: string;
}

// Ordering semantics: edits are applied sequentially. Edit N+1 operates on
// the text AFTER edit N was applied. Search strings in later edits must
// account for earlier replacements.
//
// Whitespace matching: tolerant by default. Trailing whitespace and line
// ending differences (CRLF vs LF) are normalized before matching.
// strictMatch option available for byte-exact matching when needed.
//
// Validation: search.length >= 10 required. Empty or trivially short
// search strings are rejected (too likely to match unintended locations).
//
// Ambiguous match: if search matches multiple times (after scope filtering),
// that individual edit fails but remaining edits continue. Partial progress
// is reported.

interface CodeArtifact {
  files: FileChange[];
  summary: string;
  testsIncluded: boolean;
}
```

**Why search/replace over unified diff:** LLMs produce better search/replace
than valid unified diffs. The format is self-describing, doesn't require line
numbers (which LLMs hallucinate), and each edit is independently verifiable.

### 3. Diff Application Engine

New module: `packages/diff-engine/`

```typescript
interface ApplyOptions {
  strictMatch?: boolean;  // Default: false (whitespace-tolerant)
}

interface ApplyResult {
  success: boolean;
  content: string;        // Result file content
  appliedEdits: number;   // How many edits applied
  failedEdits: EditFailure[];  // Edits that couldn't be applied
}

interface EditFailure {
  edit: Edit;
  reason: 'not-found' | 'ambiguous-match' | 'too-short';
  matchCount?: number;    // For ambiguous: how many matches found
}

function applyEdits(original: string, edits: Edit[], options?: ApplyOptions): ApplyResult;
```

**Validation pipeline:**
1. Normalize whitespace (unless strictMatch): trim trailing, normalize CRLF→LF
2. Validate: reject edits with `search.length < 10`
3. For each edit sequentially (operating on post-prior-edit text):
   a. Find `search` in current text
   b. If not found → record EditFailure, continue to next edit
   c. If multiple matches → apply scope hint if present, else record ambiguous failure
   d. If unique match → replace with `replace`
4. Return result with content (even partial), success = (failedEdits.length === 0)

**One-shot retry:** Before escalating to the full repair loop, failed edits get
one immediate retry: the failing edit + error context is re-sent to CoderAgent
for a corrected search string. This catches trivial whitespace/naming drift
without burning a full repair cycle.

**Fallback:** If the LLM produces old-style full `content` instead of `edits`
(schema non-compliance), detect and treat as full replacement WITH a warning
signal emitted. This prevents hard failures during migration but tracks
regression.

**Structured repair notes** for full repair loop escalation:
```
EDIT_FAILURE: File {path}
  Edit {n}/{total} FAILED: {reason}
  Search was: "{first 80 chars of search}..."
  Match count: {n} (expected 1)
  Suggestion: {contextual hint based on failure type}
```

### 4. Structural Extraction (Regex-Based)

**Package:** `packages/file-context/`

> **Architect condition #3:** tree-sitter WASM (37MB) exceeds Cloudflare Workers
> 10MB upload limit. Regex-based extraction provides 90% of the value at zero
> infrastructure cost. AST validation deferred to compile gate (Phase 5).

```typescript
interface FileContext {
  path: string;
  language: 'typescript' | 'json' | 'yaml' | 'markdown';
  rawContent: string;
  structure: {
    exports: string[];       // exported symbol names
    imports: string[];       // import paths
    functions: FunctionSig[];// { name, params, returnType, startLine, endLine }
    types: string[];         // type/interface names
    classes: string[];       // class names
  };
  targetSlice?: string;      // The exact code block the atom should modify
}

interface FunctionSig {
  name: string;
  params: string;
  returnType?: string;
  startLine: number;
  endLine: number;
}

function extractContext(content: string, language: string, target?: string): FileContext;
```

**Implementation:** Regex patterns for TypeScript structural extraction:
- Exports: `/export\s+(?:async\s+)?(?:function|class|const|type|interface)\s+(\w+)/g`
- Imports: `/^import\s+.*from\s+['"](.+)['"]/gm`
- Functions: `/(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)(?:\s*:\s*([^{]+))?/g`
- Types/interfaces: `/(?:export\s+)?(?:type|interface)\s+(\w+)/g`
- Classes: `/(?:export\s+)?class\s+(\w+)/g`

Function boundaries (startLine/endLine) determined by brace counting from
the match position. Not perfect but sufficient for scope hints and target slicing.

For JSON/YAML/MD: raw content only (no structural extraction needed).

### 5. Integration Points

#### 5.1 AtomExecutor DO (atom-executor-do.ts)

Before calling `executeAtomSlice()`:
- Resolve target files from atom spec (atom.targetFiles or inferred from plan)
- Fetch each via GitHub API (already authenticated for PR creation)
- Extract AST context where applicable
- Pass `fileContexts: FileContext[]` into the execution pipeline

#### 5.2 CoderAgent (coder-agent.ts)

Updated system prompt:
```
You produce targeted edits to existing files, NOT complete replacements.

For each file you modify, output an 'edits' array of search/replace pairs.
Each 'search' must be an exact substring found in the original file.
Each 'replace' is what that substring becomes.

You will receive the current file contents in the user message.
Only modify what the atom spec requires. Preserve everything else.
```

User message includes:
```
## Current File: {path}
```typescript
{rawContent or targetSlice}
```

## Structure
- Exports: {exports}
- Functions: {functions with signatures}
```

#### 5.3 generate-pr.ts

Updated file commit logic:
```
For action='create': PUT content (unchanged)
For action='modify':
  1. GET existing file from branch (already does this for SHA)
  2. applyEdits(existingContent, edits)
  3. If !result.success → skip file, emit warning signal
  4. PUT result.content
For action='delete': DELETE (unchanged)
```

**Multi-atom file serialization (Architect condition #8):**
When multiple atoms in the same WorkGraph target the same file path, their
edits must be merged before application:
1. Group FileChange entries by path across all atom results
2. Order by atom dependency (from WorkGraph DAG topological sort)
3. Concatenate edit arrays in dependency order
4. Apply merged edits once per file
5. Commit per-file-after-all-edits, not per-atom

**File content caching (Architect condition #7):**
Cache fetched file contents in DO storage for the duration of atom execution.
The branch was just created from main — content is stable during execution.
Avoids redundant GitHub API calls for multi-file atoms.

#### 5.4 ORL Integration

New failure modes:
- `F8: edit-search-not-found` — search string doesn't exist in file
- `F9: edit-ast-invalid` — result doesn't parse
- `F10: edit-ambiguous-match` — search string found multiple times

These feed into the repair loop: VerifierAgent sees which edits failed and
CoderAgent gets specific error context for retry.

### 6. File Target Resolution

Atoms in the WorkGraph have an `atomSpec` that describes what to implement.
Today this is freeform. We need atoms to declare their target files:

**Option A:** Explicit in WorkGraph atom spec (architect declares targets)  
**Option B:** CoderAgent infers from context + atom description  
**Option C:** Hybrid — architect suggests, CoderAgent confirms/adds  

**Recommendation:** Option C. The WorkGraph architect agent already produces
a plan with file paths. Thread those through as `suggestedFiles`. CoderAgent
can add files (for new imports, tests) but must justify additions.

### 7. Migration Strategy (Corrected Order — Architect Condition #10)

1. **Phase 1:** Add `packages/diff-engine` and `packages/file-context` with tests
2. **Phase 2:** Update `generate-pr.ts` to use applyEdits for modify actions
   (handler must exist BEFORE prompt change — atoms producing edits need a consumer)
3. **Phase 3:** Update CoderAgent prompt and schema to prefer edits
4. **Phase 4:** Update AtomExecutor to fetch file context pre-execution
5. **Phase 5:** Add compile gate (typecheck branch before PR creation)

**Critical ordering:** Phase 2 (handler) MUST deploy before Phase 3 (prompt flip).
If CoderAgent produces edits but generate-pr.ts can't apply them, PR generation
breaks. The fallback (detect old-style full content) in Phase 2 means existing
atoms still work while the new path is ready for edit-format output.

### 8. Compile Gate (Bonus — addresses Architect concern 5B)

After all files committed to branch, before PR creation:
```
POST /repos/{owner}/{repo}/actions/workflows/typecheck.yml/dispatches
  { ref: branchName }
```

Wait for check to complete. If typecheck fails → don't create PR, emit
`synthesis:compile-failed` signal that feeds back into retry.

## Non-Goals

- Real-time file watching (Factory operates on snapshots)
- Multi-file transactional commits (GitHub API is per-file; acceptable for now)
- Supporting non-TypeScript AST (Python, Go) — future extension
- Replacing the entire CoderAgent (just changing its output contract)

## Success Criteria

1. No Factory-generated PR deletes code it wasn't targeting
2. Every "modify" atom receives current file state before execution
3. AST validation catches malformed output before commit
4. Repair loop gets structured error context (which edit failed, why)
5. Migration is incremental — no big-bang deploy

## Dependencies

- GitHub API (already authenticated in generate-pr.ts)
- No new infrastructure services required
- No WASM dependencies (regex-based extraction, compile gate handles AST validation)
