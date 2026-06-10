# Requirements — ksp-gears CF Gate Fixes
> Feature: 001-ksp-gears-cf-fixes
> Source: cf-diagnosis-ksp-gears.md (reversa-cf-specialist)
> Date: 2026-06-10

## Objective
Fix the 6 CF gate failures identified by reversa-cf-specialist that block `wrangler dev` from booting for the `ff-flue` worker.

## Requirements

- R01: `.flue/wrangler.jsonc` must declare `durable_objects.bindings` for all 5 Flue workflow DO classes (CF002)
- R02: `skill_loader.ts` must read skills from `.agents/skills` not `.agent/skills` (CF005)
- R03: `agents`/zod-4 conflict must be resolved — unblocks build (CF001 — architecture gate)
- R04: `<provision>` placeholders in `packages/gears/wrangler.jsonc` must be filled (CF004)

## Out of scope
- CF003 (cross-script dev topology) — operational, no code change
- CF006 (Sandbox Dockerfile) — deferred
- CF007 (cosmetic rename) — deferred
