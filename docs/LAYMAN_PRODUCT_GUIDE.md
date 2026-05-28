# Function Factory — Plain-English Product Guide

This guide explains Function Factory without engineering jargon.

## What It Is

Function Factory is a system that helps teams turn a goal into reliable action.

It does three big things:

1. Understands what you want done.
2. Runs the work through an execution system.
3. Checks results and keeps improving over time.

## What Problem It Solves

Most automation tools can run tasks, but they often fail in messy real-world conditions.

Function Factory is built to answer:

- Did the work actually happen?
- Did it meet the goal?
- Can we prove that with evidence?
- If it failed, can we correct and re-run safely?

## How It Works (Simple Flow)

1. **Define the intent**  
   You describe what outcome you want.

2. **Convert intent into executable steps**  
   The system creates a machine-runnable plan.

3. **Run the plan**  
   Work is executed in the runtime layer (currently Gas City).

4. **Collect proof**  
   The system receives result signals and verification evidence.

5. **Track health continuously**  
   Monitoring checks that the process stays healthy over time.

6. **Escalate when needed**  
   If signals go stale or failures repeat, incidents are raised and surfaced.

## Why Teams Use It

- **Reliability:** It’s not “fire and forget.” It checks and re-checks.
- **Traceability:** You can see where each result came from.
- **Safety:** Failed or suspicious runs are surfaced, not hidden.
- **Operational control:** Operators can monitor, retry, redispatch, or cancel.

## What You See Day to Day

- A live health/status view.
- A production smoke flow to verify deployment and runtime path.
- An SLO dashboard to quickly show pass/fail health indicators.
- Incident runbooks when something goes wrong.

## Current V1 State

As of 2026-05-28:

- Production deploy + dispatch + callback + monitoring path is live.
- Operational runbooks and dashboard commands are in place.
- Direct monitor-run calls can be slow sometimes, but status fallback is built in and used for production checks.

## Where To Go Next

- Product details: [`PRODUCT_DOCUMENTATION.md`](PRODUCT_DOCUMENTATION.md)
- Operator guide: [`how-to/OPERATOR_RUNBOOK_GAS_CITY_PRODUCTION.md`](how-to/OPERATOR_RUNBOOK_GAS_CITY_PRODUCTION.md)
- Incident guide: [`how-to/INCIDENT_RUNBOOK_GAS_CITY.md`](how-to/INCIDENT_RUNBOOK_GAS_CITY.md)
- SLO dashboard guide: [`how-to/SLO_DASHBOARD.md`](how-to/SLO_DASHBOARD.md)
