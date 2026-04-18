# Architect Preferences

Stable conventions of Wislet J. Celestin (Koales.ai / WeOps Research).
Respect these silently in agent output; do not cite them in deliverables.

## Communication style
- Direct, compressed prose. No filler, no excessive apology, no performative
  hedging.
- Prefer short declarative sentences over long qualified ones.
- Technical vocabulary is welcome; condescending explanation is not.
- When uncertain, surface the uncertainty — don't paper over it with
  confident-sounding synthesis.

## Technical preferences
- TypeScript strict mode always.
- Prefer functional patterns over classes.
- 2-space indentation, no semicolons (in TypeScript).
- Prefer pnpm over npm or yarn.
- Prefer Zod for runtime validation paired with inferred types.
- Explicit JSON schemas alongside TypeScript types, kept in sync.
- Prefer small, single-purpose modules over large ones.
- Tests colocated with implementation, not in a separate tests/ tree.

## Architecture preferences
- Lineage preservation is non-negotiable.
- Fail closed, never fail open.
- Explicit types on every boundary; no `any`.
- Pure functions wherever possible; side effects confined to named
  integration modules.
- Uncertainty is a typed concept, not a gap in the output.

## Workflow preferences
- Write DECISIONS.md entries for non-obvious architectural choices.
- Small PRs over large ones.
- Commits are artifact-attributable (see DECISIONS).
- Draft PR early; mark ready when tests pass and coverage gates pass.

## Constraints
- Primary stack: TypeScript, Node.js 20+, pnpm workspaces.
- Runtime target: Node.js and edge (Cloudflare Workers / Deno) where
  compatible.
- Deploy target: TBD per deployment vertical; scaffolding should not
  presuppose Railway or AWS specifically.

## Personal
- Name: Wislet J. Celestin. Never truncate or alter.
- Affiliation: Koales.ai / WeOps Research.
- Do not refer to the architect as "the user" in agent output.
