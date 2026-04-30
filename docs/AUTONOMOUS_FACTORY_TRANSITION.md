# Autonomous Factory Transition

This document defines the transition from manual Codex operation to Function
Factory as the autonomous scheduler for coding work.

## Target Operating Model

Function Factory is the control plane. Codex is a worker runtime.

The steady-state loop is:

1. Governor reads Factory artifacts and selects the next admissible WorkGraph node.
2. Scheduler converts the node into a role-scoped `AgentRequest`.
3. Queue persists the request and emits `QueueEvent` records.
4. Codex runner claims one request in a clean session.
5. Runner creates a PR branch, implements within `allowedPaths`, runs required commands, and returns `AgentResult`.
6. Critic, tester, verifier, and coverage gates evaluate evidence.
7. Governor either advances the WorkGraph, emits follow-up requests, or blocks for a human decision.

## Runtime Boundary

The boundary is explicit so the Factory can drive multiple worker backends later:

1. `AgentRequest` is the only way to ask a worker to act.
2. `AgentResult` is the only way for a worker to report completion.
3. `QueueEvent` is the durable audit stream for queue behavior.

Worker internals are replaceable. The contract is not.

## Autonomy Levels

Level 0: Manual

Codex acts directly. Factory artifacts are consulted by humans and operators.

Level 1: Recommend Only

Governor proposes the next request, but no queue item is written.

Level 2: Enqueue Only

Governor writes `AgentRequest` records. A human manually launches workers.

Level 3: Branch PR

Workers claim queue items, create branches, open PRs, and return evidence. Human
approval is still required for merge, deploy, and secrets.

Level 4: Multi-Agent PR

Architect, builder, tester, critic, and verifier requests can run as a coordinated
set against the same WorkGraph node. Merge remains human-approved.

Level 5: Reserved

Auto-merge or production deploy requires a later ADR and stronger policy gates.

## First Dogfood Workload

Strategy.Recipes is the first external product workload.

The initial request fixture is:

`packages/autonomous-scheduler/fixtures/strategy-recipes-agent-request.json`

It asks a builder worker to implement the first Strategy.Recipes product view
from `Strategy_Recipes_UX_Architecture_v1.1.md` in a separate repo and PR branch.

## Production Alpha Exit Criteria

Function Factory reaches production alpha autonomy when:

1. The queue persists `AgentRequest`, claim, heartbeat, result, and dead-letter records.
2. The Codex runner can claim one request and return a validated `AgentResult`.
3. PR/branch mode is enforced by policy before execution begins.
4. Required command output is captured as evidence.
5. Critic and verifier results are linked back to the originating WorkGraph node.
6. The operator cockpit can show active queue, latest run, latest evidence, and blocked decisions.
7. A Strategy.Recipes vertical slice is built through the queue rather than by manual Codex task selection.

## Immediate Implementation Sequence

1. Contract package: `@factory/autonomous-scheduler`.
2. JSONL queue using the contract package.
3. Codex runner adapter that claims one request and opens a PR branch.
4. Governor scheduler that emits one Strategy.Recipes dogfood request.
5. Critic/verifier requests generated from the builder result.
6. Cockpit views over queue state and evidence.

Steps 1 and 2 are bootstrapped by the initial autonomous scheduler contract
slice. The Codex runner adapter is also bootstrapped: it validates an
`AgentRequest`, derives the PR branch, emits git preflight commands, builds the
Codex worker prompt, executes the command plan through an injectable executor,
converts runner evidence into a validated `AgentResult`, and writes durable
artifact bundles. The next production-alpha slice is wiring PR creation.
