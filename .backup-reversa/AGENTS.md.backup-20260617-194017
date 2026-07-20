# Function Factory — Agent Instructions

The authoritative agent map lives at `.agent/AGENTS.md`. Read it in full before acting on this repo.

@.agent/AGENTS.md

<!-- tessera:start -->
# Tessera — Code Intelligence

This project is indexed by Tessera as **function-factory** (19327 symbols, 28964 relationships, 300 execution flows). Use the Tessera MCP tools to understand code, assess impact, and navigate safely.

> If any Tessera tool warns the index is stale, run `npx tessera analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `tessera_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `tessera_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `tessera_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `tessera_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `tessera_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `tessera_rename` which understands the call graph.
- NEVER commit changes without running `tessera_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `tessera://repo/function-factory/context` | Codebase overview, check index freshness |
| `tessera://repo/function-factory/clusters` | All functional areas |
| `tessera://repo/function-factory/processes` | All execution flows |
| `tessera://repo/function-factory/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/tessera/tessera-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/tessera/tessera-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/tessera/tessera-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/tessera/tessera-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/tessera/tessera-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/tessera/tessera-cli/SKILL.md` |

<!-- tessera:end -->
