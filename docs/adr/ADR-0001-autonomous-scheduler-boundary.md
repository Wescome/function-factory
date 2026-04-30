# ADR-0001: Autonomous Scheduler Boundary

Status: Accepted

Date: 2026-04-30

## Context

Function Factory must become the autonomous product/platform that schedules and
verifies coding work. Codex is not the product. Codex is a runtime worker that
Function Factory can launch, constrain, and evaluate.

Strategy.Recipes is a separate product/platform workload. Function Factory v1.0
must be able to build Strategy.Recipes from Factory artifacts without the human
or this chat session manually deciding each implementation step.

The prior manual workflow was useful for bootstrapping, but it inverted the
target architecture:

1. Human or Codex selected the next task.
2. Codex implemented directly.
3. Factory artifacts were consulted or updated afterward.

The target workflow reverses this:

1. Function Factory selects a WorkGraph node.
2. The Governor emits an `AgentRequest`.
3. A queue persists the request.
4. A Codex runner claims the request in a fresh branch/session.
5. The runner returns an `AgentResult` with PR, diff, test, and artifact evidence.
6. Critic, tester, verifier, and coverage components decide whether the graph can advance.

## Decision

Function Factory owns the scheduling boundary. Codex runners are stateless
workers behind a durable queue contract.

The initial production posture is PR/branch mode:

1. Workers may create branches and pull requests.
2. Workers may only modify declared repo-relative `allowedPaths`.
3. Workers may not merge default branches.
4. Workers may not deploy to production.
5. Workers may not force-push.
6. Workers may not edit secrets.
7. Completed work must return evidence before the Governor advances the WorkGraph.

The first contracts are:

1. `AgentRequest`: work assigned from a WorkGraph node to a role-specific worker.
2. `AgentResult`: worker evidence returned after implementation or refusal.
3. `QueueEvent`: append-only event emitted at the queue boundary.

These contracts live in `@factory/autonomous-scheduler`.

## Consequences

Function Factory can dogfood external repo builds without allowing uncontrolled
mutation. Strategy.Recipes becomes a workload target, not a dependency of
Function Factory.

Autonomy increases by moving from `recommend_only` to `enqueue_only` to
`branch_pr` to `multi_agent_pr`. Auto-merge is intentionally not part of the
initial contract.

The Governor and operator cockpit can display queue state, active claims,
returned evidence, and blocked decisions without needing to understand Codex
session internals.

## Non-Goals

This ADR does not implement the long-running runner daemon.

This ADR does not implement auto-merge.

This ADR does not make Strategy.Recipes part of the Function Factory repo.

This ADR does not replace the Factory artifact pipeline. It adds an execution
boundary downstream of WorkGraphs.

## Source Inputs

1. Operator directive on 2026-04-30: Function Factory must autonomously drive
   Codex as a runtime scheduler.
2. `FF-CLI-DESIGN-V2.md`: terminal UX and Governor/operator interaction model.
3. `Strategy_Recipes_UX_Architecture_v1.1.md`: first external product workload.
4. Prior Ralph Wiggum loop analysis: fresh worker sessions, durable task state,
   small tasks, evidence-backed exits.
