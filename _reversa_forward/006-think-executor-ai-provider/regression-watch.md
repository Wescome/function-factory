# Regression Watch — 006-think-executor-ai-provider

| ID   | Invariant                                                                             | Check location           | Status |
|------|---------------------------------------------------------------------------------------|--------------------------|--------|
| W001 | ConductorEnv has CF_API_TOKEN and CLOUDFLARE_ACCOUNT_ID fields                        | conducting-agent.ts      | [ ]    |
| W002 | buildConductingAgent uses OpenAICompatibleConfig for cloudflare/* model IDs           | conducting-agent.ts      | [ ]    |
| W003 | SuccessCondition schema includes {type: "always"}                                     | atom-directive.ts        | [ ]    |
| W004 | evaluateCondition handles case "always": return true                                  | think-executor.ts        | [ ]    |
| W005 | wrangler.jsonc vars includes CLOUDFLARE_ACCOUNT_ID                                   | wrangler.jsonc           | [ ]    |
