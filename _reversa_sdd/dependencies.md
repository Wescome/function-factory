# Dependencies — function-factory

> Phase 1 · Scout · Generated 2026-06-08

---

## Package Manager

**pnpm 9.0.0** with pnpm workspaces. Overrides: `unicorn-magic@0.4.0`, `execa@^8.0.0`.

---

## Internal Package Dependency Graph

```
@factory/schemas (zod)                    ← foundation, no internal deps
    │
    ├── @factory/verification             (schemas, zod, yaml)
    │       └── @factory/compiler        (schemas, verification, zod, yaml)
    │
    ├── @factory/capability-delta         (schemas, zod, yaml)
    ├── @factory/assurance-graph          (schemas, zod)
    ├── @factory/runtime                  (schemas, zod)
    ├── @factory/architecture-candidates  (schemas)
    ├── @factory/candidate-selection      (schemas)
    ├── @factory/runtime-admission        (schemas)
    ├── @factory/execution-lifecycle      (schemas)
    ├── @factory/controlled-effectors     (schemas)
    ├── @factory/effector-realization     (schemas)
    ├── @factory/observability-feedback   (schemas)
    ├── @factory/signal-hygiene           (schemas)
    ├── @factory/adaptive-recalibration   (schemas)
    ├── @factory/selection-bias           (schemas)
    ├── @factory/meta-governance          (schemas)
    ├── @factory/policy-activation        (schemas)
    ├── @factory/intent-authoring         (schemas)
    └── @factory/recursion-governance     (schemas)

Workers (not packages):
  workers/ff-pipeline   → @factory/schemas, @factory/db-client, @factory/artifact-validator,
                          @factory/task-routing, @factory/file-context, @factory/gdk-agent,
                          @factory/gdk-ai, cloudflare:workers, agents
  workers/ff-gates      → @factory/schemas, @factory/db-client, zod, cloudflare:workers
  workers/gascity-supervisor → @cloudflare/containers
  workers/ff-gateway    → cloudflare:workers
```

---

## Key External Dependencies

| Package | Version | Purpose | Confidence |
|---------|---------|---------|-----------|
| `zod` | ^3.x | Schema validation for all artifact types | 🟢 CONFIRMED |
| `yaml` | ^2.4.0 | YAML serialization (specs, configs) | 🟢 CONFIRMED |
| `typescript` | ^5.4.0 | Language | 🟢 CONFIRMED |
| `vitest` | ^1.4.0 | Test framework | 🟢 CONFIRMED |
| `tsx` | ^4.21.0 | TypeScript execution for scripts | 🟢 CONFIRMED |
| `@cloudflare/sandbox` | (via wrangler) | Sandboxed code execution | 🟢 CONFIRMED |
| `@cloudflare/containers` | (via wrangler) | Container DOs for Gas City | 🟢 CONFIRMED |
| `agents` | (from CF) | Agent base class for SynthesisCoordinator | 🟢 CONFIRMED |
| `@weops/gdk-agent` | (internal) | agentLoop, callable decorators | 🟢 CONFIRMED |
| `@weops/gdk-ai` | (internal) | AI client abstraction (Type, Model) | 🟢 CONFIRMED |

---

## ArangoDB Schema (Surfaced — not detailed)

Collections are created on-demand via `db.ensureCollection()`. Schemas enforced by `@factory/artifact-validator` using Zod validators from `@factory/schemas`.

Migration files: none identified (schema-on-create pattern). 🟡 INFERRED — no migrations directory found.

---

## CI/CD Scripts (package.json)

| Script | Command | Purpose |
|--------|---------|---------|
| `build` | `pnpm -r build` | Build all packages |
| `test` | `pnpm -r test` | Run all tests |
| `typecheck` | `pnpm -r typecheck` | TypeScript type checks |
| `compile` | `@factory/compiler run compile` | Run compiler package |
| `audit:docs` | `node scripts/audit-docs.mjs` | Docs coverage audit |
| `audit:ontology` | `node scripts/audit-ontology-hard-cut.mjs` | Ontology hard-cut audit |
| `dream` | `tsx .agent/tools/dream.ts` | Agent dream tool |
| `bootstrap` | `tsx scripts/bootstrap.ts` | System bootstrap |
