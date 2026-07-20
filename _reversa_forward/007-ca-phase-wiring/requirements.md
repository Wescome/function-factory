---
# 007-ca-phase-wiring

## JTBD
When CommissioningAgentDO receives a /signal, I want real LLM inference driving all 5 phases, so I can run a genuine commission flow that produces a real WorkGraph and forwards it to MediationAgentDO.

## Source
Architect analysis 2026-06-15 against SPEC-FF-CA-SKILLS-001:
- G1 (CRITICAL): _generateText() is a stub returning text = prompt — no model ever called
- G4 (HIGH): getModel() / beforeTurn() use 'as never' casts — no LanguageModel constructed
- G7 (HIGH): No AI binding, CF_API_TOKEN, CLOUDFLARE_ACCOUNT_ID in wrangler or env
- G3 (HIGH): DREAM_DO declared in env.ts but binding stripped — runtime crash
- G5 (MEDIUM): validateAgainstConstraints() is a TODO returning {valid:true} unconditionally

## Files
- packages/commissioning-agent/src/env.ts (G3/G7: remove DREAM_DO, add AI + secrets)
- packages/commissioning-agent/src/index.ts (G4/G1: getModel, beforeTurn, _generateText)
- packages/commissioning-agent/src/phases/workgraph-authoring.ts (G5: real constraint check)
- workers/ff-commissioning-agent/wrangler.jsonc (G7: AI binding + vars)

## Decisions
- DREAM_DO: remove from code (binding already stripped)
- AI provider: CF AI Gateway, account cb56a846c70a38987f31cf6e2b85cb57
- Models: claude-sonnet-4-6 (phases), claude-opus-4-6 (hypothesis-formation)
- _generateText shape: ai-sdk generateText option A (one-shot, no tools)
- Constraint enforcement: semantic LLM audit
- Migration tag: keep v1 (already deployed)
---
