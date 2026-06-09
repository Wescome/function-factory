---
id: IS-CARETRACE-REALTIME-POC-001
functionId: FN-CARETRACE-REALTIME-POC-001
status: active
version: "1.0"
date: 2026-06-01
source_refs:
  - CARETRACE-REALTIME-POC-001
explicitness: explicit
---

# Intent Specification: CareTrace Realtime POC

## Intent

Build a proof-of-concept clinical intelligence layer for CareTrace that proves the full media pipeline: browser-based video call via Cloudflare Realtime SFU, a silent AI agent that joins the meeting, transcribes speech via Deepgram, extracts clinical signals via Workers AI, and fans them out in real time to a coordinator dashboard.

## System Components

Four runtime components deployed on Cloudflare:

1. **caretrace-session** (Worker) — creates meetings and issues participant tokens via Cloudflare Realtime REST API
2. **caretrace-agent** (Worker + Durable Object) — silent AI agent; joins meeting, Deepgram STT → Workers AI (Llama 3.1 8B) signal extraction
3. **caretrace-patient-state** (Worker + Durable Object) — signal storage (SQLite) + WebSocket fan-out to coordinator dashboard
4. **dashboard/** — three static HTML files; no build step

## Outcome

A working POC where two browser tabs join a video call, a clinical AI agent joins silently, and clinical signals (pain_mention, medication_question, family_distress, symptom_observation, care_concern) appear in real time on a coordinator dashboard within 2–5 seconds of being spoken.

## Constraints

- All code must be TypeScript with strict mode
- No third-party meeting UI libraries — raw Cloudflare Realtime SFU API only
- caretrace-patient-state must be deployed before caretrace-agent (binding dependency)
- All secrets via wrangler secret put — never in source
- Dashboard is static HTML (file:// compatible, no build step)
- `npm run typecheck` must exit 0 with zero TypeScript errors
