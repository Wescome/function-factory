# Design — @factory/ksp-sdk

> Reversa SDD · Phase: Writer · Generated: 2026-06-10
> Module: `packages/knowing-state-sdk/` → published as `@factory/ksp-sdk`
> Source specs: SPEC-KSP-BEAD-GRAPH-001 §8, §12; SPEC-KSP-ARCH-001 §3; CLAUDE.md Step 21

---

## Package Structure

```
packages/knowing-state-sdk/
├── package.json          — declares dep on @factory/bead-graph only; exports src/index.ts
├── tsconfig.json         — extends root tsconfig; references @factory/bead-graph
└── src/
    └── index.ts          — single star re-export from @factory/bead-graph
```

**File count: 3**. No additional files are permitted or required.

### File Responsibilities

| File | Responsibility |
|------|---------------|
| `package.json` | Package identity (`@factory/ksp-sdk`), single dependency (`@factory/bead-graph`), main/types entry points pointing to `src/index.ts` |
| `tsconfig.json` | TypeScript project references to `@factory/bead-graph`; strict mode on |
| `src/index.ts` | `export * from '@factory/bead-graph'` — the entire public surface |

---

## Key Algorithm: The Re-Export Shim

There is no algorithm. The implementation is:

```typescript
// packages/knowing-state-sdk/src/index.ts
export * from '@factory/bead-graph';
```

One line. This is not a simplification — this is the exact specification from CLAUDE.md Step 21 and SPEC-KSP-BEAD-GRAPH-001 §12. The complexity budget for this module is zero.

---

## Cloudflare Primitives Used

None. `@factory/ksp-sdk` is a type-only package. It does not execute at runtime, does not import Cloudflare Workers types, and does not contain any Worker, DO, KV, D1, or Queue bindings. All Cloudflare primitives are implemented in `@factory/bead-graph`.

---

## What This Package Exports (via @factory/bead-graph)

All of these types flow through the re-export. Consumers see them as if they came from `@factory/ksp-sdk`:

### Core SDK Interface

```typescript
// KnowingStateSDK<PolicyContent, TrustContent, ExecutionContent, OutcomeContent>
interface KnowingStateSDK<P, T, E, O> {
  openSession(orgId: string, roleId: string, agentId: string): Promise<Session>;
  closeSession(sessionId: string): Promise<void>;
  retrieveKnowingState(sessionId: string, category?: string): Promise<KnowingState<T, P>>;
  evaluateTrust(sessionId: string, subjectId: string): Promise<TrustEvaluation<T>>;
  writeExecutionBead(sessionId: string, payload: E): Promise<string>;
  writeOutcomeBead(sessionId: string, executionBeadId: string, outcome: O): Promise<string>;
  getOpenAmendments(orgId: string): Promise<AmendmentBeadContent[]>;
  checkConsent(sessionId: string, action: string): Promise<boolean>;
}
```

### Supporting Types

```typescript
type Autonomy = 'SUGGEST' | 'PROPOSE' | 'EXECUTE_BOUNDED' | 'EXECUTE_FULL';

interface Session {
  sessionId: string;
  orgId: string;
  roleId: string;
  agentId: string;
  autonomyFloor: Autonomy;
  ksRetrievedAt?: number;
}

interface KnowingState<TrustContent, PolicyContent> {
  policy: PolicyContent | null;
  trustedSubjects: TrustContent[];
  consent: { grants: string[] } | null;
  retrievedAt: number;
}

interface TrustEvaluation<TrustContent> {
  trusted: boolean;
  trustBead: TrustContent | null;
  autonomy: Autonomy;
}
```

### All 8 Bead Types (Zod schemas + TypeScript inferred types)

BaseBead, PolicyBead, TrustBead, ExecutionBead, OutcomeBead, AmendmentBead, ConsentBead, EscalationBead, AuditBead, AnyBead (discriminated union).

### Error Classes

BeadImmutabilityError, BeadIntegrityError, SessionNotInitialized, AutonomyDegradedError.

### Utility

`computeBeadId(type, content, parentIds): string` — SHA-256 content-addressed bead identity function.

---

## Data Flows

### Inbound (who calls @factory/ksp-sdk)

| Consumer | Usage |
|----------|-------|
| Factory Mediation Agent DO | `openSession` → `retrieveKnowingState` → `evaluateTrust` → `writeExecutionBead` → `writeOutcomeBead` |
| `@factory/loop-closure` | `KnowingState`, `Session`, bead type imports for bridge-point typing |
| ComeFlow (external) | Full `KnowingStateSDK` interface; domain-specific type params scoped to Commerce |
| CareTrace (external) | Full `KnowingStateSDK` interface; domain-specific type params scoped to Clinical |

### Outbound (what @factory/ksp-sdk calls)

Nothing. The re-export shim does not call anything at runtime. `@factory/bead-graph` is the runtime implementation. Consumers who hold a `KnowingStateSDK` instance are calling into `@factory/bead-graph` through the interface contract — `@factory/ksp-sdk` merely published that contract as a stable import path.

---

## Integration Points

### Direct Dependency

```
@factory/ksp-sdk
  └── depends on: @factory/bead-graph (sole dependency)
```

### Dependency Direction (from architecture.md KSP Package Build Order)

```
@factory/bead-graph   →  @factory/ksp-sdk  →  consumers
      (impl)                 (shim)            (Factory, ComeFlow, CareTrace)
```

The arrow means "used by" / "depends on." The shim is between the implementation and consumers.

### Packages That Must NOT depend on @factory/ksp-sdk from inside the storage layer

`@factory/bead-graph` MUST NOT import `@factory/ksp-sdk`. This would create a circular dependency. The dependency is strictly one-directional: ksp-sdk imports bead-graph, never the reverse.

---

## SQLite Schemas

None. This package has no storage, no schema, no migrations.

---

## package.json Shape

```json
{
  "name": "@factory/ksp-sdk",
  "version": "0.1.0",
  "private": true,
  "main": "src/index.ts",
  "types": "src/index.ts",
  "dependencies": {
    "@factory/bead-graph": "workspace:*"
  }
}
```

The `dependencies` block MUST contain exactly one entry. The workspace protocol (`workspace:*`) is correct for a monorepo package reference.

---

## tsconfig.json Shape

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "references": [
    { "path": "../bead-graph" }
  ],
  "include": ["src"]
}
```

The `references` array MUST include `@factory/bead-graph`'s tsconfig path. This is what enables composite project builds and correct incremental compilation.
