| ID   | Action                                          | Files                        | Dep  | Gate            | Status |
|------|-------------------------------------------------|------------------------------|------|-----------------|--------|
| T001 | Add AI binding + vars to wrangler.jsonc         | wrangler.jsonc               | —    | dry-run         | [X]    |
| T002 | Remove DREAM_DO + add AI/CF vars to env.ts      | env.ts                       | —    | tsc             | [X]    |
| T003 | Fix getModel() + beforeTurn() real LanguageModel| index.ts                     | T002 | tsc             | [X]    |
| T004 | Replace _generateText stub with real inference  | index.ts                     | T003 | tsc             | [X]    |
| T005 | Replace validateAgainstConstraints TODO         | workgraph-authoring.ts       | T004 | tsc             | [X]    |
| T006 | Gate: pnpm --filter @factory/commissioning-agent tsc | —                       | T005 | —               | [X]    |
| T007 | Deploy + live smoke test                        | —                            | T006 | wrangler deploy | [X]    |
