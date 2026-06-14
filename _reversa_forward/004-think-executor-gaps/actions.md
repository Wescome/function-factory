| ID   | Action                                          | Files               | Dep  | Gate               | Status |
|------|-------------------------------------------------|---------------------|------|--------------------|--------|
| T001 | Add claimBead call to executeAtom()             | think-executor.ts   | —    | gears typecheck    | [X]    |
| T002 | Gate: pnpm --filter @factory/gears typecheck    | —                   | T001 | —                  | [X]    |
| T003 | Add /consent route + recordConsent() + table    | coordinator-do.ts   | —    | gears typecheck    | [X]    |
| T004 | Gate: pnpm --filter @factory/gears typecheck    | —                   | T003 | —                  | [X]    |
| T005 | Add runId to atom-execute payload + bead chain  | queue-handler.ts    | T001 | ff-pipeline tcheck | [X]    |
| T006 | Gate: pnpm --filter @factory/ff-pipeline tcheck | —                   | T005 | —                  | [X]    |
| T007 | Final gate: pnpm typecheck (repo-wide)          | —                   | T006 | —                  | [X]    |
