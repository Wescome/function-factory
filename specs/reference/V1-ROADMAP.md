# Function Factory V1 Roadmap

**Status:** Draft  
**Date:** 2026-05-28  
**Scope:** Production V1 completion for Factory + Gas City execution path  
**Authority anchors:** `DECISIONS.md` (Gas City supersedes NLAH), `BOOTSTRAP-GOAL-SET.md`, `ARCHITECTURE-ROADMAP-GAS-CITY-FACTORY.md`

## Current baseline (as of 2026-05-28)

- Live Cloudflare deploy, seed, dispatch, webhook, and autonomy status flows are operational.
- Latest smoke run dispatched successfully and returned healthy autonomy status (`ok=true`, `monitored=1`, no open incidents).
- Dispatch/autonomy POST behavior remains intermittently slow; smoke now fails only on unhealthy final status.

## Goals 1-6 (V1)

## Goal 1 — Release Reliability Gate

**Objective:** Every production deploy is automatically blocked or rolled back on hard failures.  
**Deliverables:**
- CI gate requires: typecheck, full tests, ontology audit, smoke precheck.
- Post-deploy production smoke gate runs automatically.
- Rollback playbook/script validated on live environment.

**Exit criteria:**
- 5 consecutive production deploys pass all gates with no manual intervention.

## Goal 2 — Dispatch Path Reliability

**Objective:** Make Gas City dispatch behavior predictable under transient failures.  
**Deliverables:**
- Explicit retry/backoff strategy for dispatch HTTP sequence.
- Error taxonomy for `failed`, `timeout_call_*`, disconnect, auth, and upstream unavailability.
- Synthetic dispatch probe with threshold-based alerting.

**Exit criteria:**
- >=99% dispatch success over 7-day soak.
- 100% of failures classified into known error taxonomy.

## Goal 3 — Webhook + Trust Hardening

**Objective:** Ensure event intake is secure, replay-safe, and operationally deterministic.  
**Deliverables:**
- HMAC replay-window + nonce/dedup hardening.
- Secret rotation runbook with scheduled execution.
- Audit trail linking webhook events to VR/INC artifacts.

**Exit criteria:**
- Forged/replayed callback tests fail closed.
- Two successful secret rotation drills without service interruption.

## Goal 4 — Autonomy Monitoring Robustness

**Objective:** Persistence monitoring is always observable and decision-ready.  
**Deliverables:**
- Harden `POST /gascity/autonomy/run` path (async/queued or longer timeout budget).
- Keep `/gascity/autonomy/status` as source of truth with freshness SLA.
- Alerting for stale monitor runs and detector freshness regressions.

**Exit criteria:**
- No ambiguous monitor outcomes for 7 consecutive days.
- All stale-monitor incidents auto-create `INC-*` with operator signal.

## Goal 5 — Lifecycle + Amendment Control

**Objective:** Close the loop from failed execution to bounded amendment behavior.  
**Deliverables:**
- Enforce lifecycle invariants (`accepted -> monitored`, regressions, retirement gates).
- Enforce amendment-depth guard and recurring-incident pressure escalation.
- Nightly verification report for lifecycle consistency and lineage completeness.

**Exit criteria:**
- 7 nightly runs with no lifecycle inconsistency or lineage break.
- Amendment loops never exceed configured depth without incident emission.

## Goal 6 — GA Operations + DR

**Objective:** V1 is operable by runbook with proven recovery.  
**Deliverables:**
- SLO dashboard (dispatch, webhook acceptance, autonomy freshness, incident rate).
- Incident response playbooks for top failure modes.
- Backup/restore drill for persistence store and configuration state.

**Exit criteria:**
- One game day passes target RTO/RPO.
- 14-day stability window: no unresolved Sev-1/Sev-2 incidents.

## Phase plan

1. **Phase A (Week 1):** Goals 1-2 baseline gates and dispatch reliability.
2. **Phase B (Week 2):** Goals 3-4 security hardening and monitor robustness.
3. **Phase C (Week 3):** Goal 5 lifecycle/amendment enforcement and nightly verification.
4. **Phase D (Week 4):** Goal 6 operations readiness, DR drill, GA cut decision.

## V1 Go/No-Go checklist

- All Goal 1-6 exit criteria met.
- Production smoke passes from clean branch without manual patching.
- Observability and alert routes confirmed by injected-failure tests.
- Final decision log entry records V1 readiness and residual risks.
