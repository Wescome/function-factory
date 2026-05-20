# Current Workspace

## Status
Session ended 2026-05-20. Handover written by GUV.

## Branch
`factory/fp-motdwvr2-w7un` — 16 commits ahead of origin (pushed).

## What was accomplished this session

### Spec docs committed and pushed (branch above)

**GOVD-GAS-CITY-PHASE1-INTEGRATION.yaml** — 14 architecture decisions, all
approved by Wes (2026-05-20). Status: DECIDED. Includes full Candidate Sets
and rejection predicates per SE Ontology Axiom A9 (Elucidation Obligation).
Three corrections added as `*_correction` / `*_grounding` fields:
- D1: Execution Packet data flow (parameters→[vars]; RoleInstruction→[[steps]])
- D8: Gas City has no native webhooks; RELEASE step HTTP POST is the mechanism
- D-NEW-1: Fidelity Verification LLM tension dissolved (deterministic via
  acceptance criteria bridge)

**ARCHITECTURE-ROADMAP-GAS-CITY-FACTORY.md** — fully revised:
- IP-1: mapping table corrected to use actual EP field names
- IP-2: OPR-* → VR-* (kind=fidelity) throughout
- IP-3: Fidelity Verification described as deterministic (no LLM)
- IP-4: Q4-A answered (RELEASE step, not Gas City native webhook)
- Decision table: all 14 approved decisions, prose format (no A-Z codes)
- Phase 2 forces updated

**SE-DECOMPOSITION-GAS-CITY-FACTORY.md** — previously revised (prior session):
IP-3 removed, Coherence VR as pre-dispatch only, VERIFY stage Gas City-internal.

**Trellis nomenclature purge** (2026-05-20):
- "Trellis" has no referent (NLAH abandoned per ADR-010)
- Files renamed: TRELLIS-EXECUTION-PACKET.md → EXECUTION-PACKET.md
              TRELLIS-IMPLEMENTATION-PLAN.md → EXECUTION-PACKET-IMPLEMENTATION-PLAN.md
              TRELLIS-REFACTOR-FIRST-CUT.md → EXECUTION-LAYER-REFACTOR-FIRST-CUT.md
- Type names: TrellisExecutionPacket → ExecutionPacket, etc.
- Artifact prefix: TEP-* → EP-*
- Historical ADRs 009/010 left intact (historical record)

## Key architecture facts (do not re-derive)

**Boundary (SE Ontology §7):**
- Factory owns: Specification (Signal→IS→ES→EP), Coherence VR (pre-dispatch),
  Amendment generation, Fidelity Verification (structural, post-execution),
  Lifecycle governance
- Gas City owns: Execution (sessions, beads, formulas), VERIFY stage
  (fidelity-verification-function), convergence loop, Health Patrol, GUPP

**Execution Packet → Formula TOML (deterministic):**
- EP.DomainAdapterBinding.executionRequest.parameters → [vars]
- EP.RoleInstruction[].roleId → [[steps]] name
- EP.RoleInstruction[].instruction + inputs + outputs → step body

**Molecule completion notification:**
- Gas City has no native webhook emission
- RELEASE [[step]] in Formula TOML HTTP POSTs to Factory POST /webhooks/gascity
- Payload HMAC-signed (D8)

**Fidelity Verification (Factory-side, post molecule.completed):**
- Deterministic — no LLM
- (1) Evidence completeness: all required evidence items produced?
- (2) Acceptance criteria verdict bijection: PASS/FAIL covers every IS criterion?
- (3) Execution coverage: all IS validation obligations exercised?
- Produces VR-* with kind=fidelity (not OPR-*, which has no ontological home)

**Formula artifact:**
- Prefix: FORM-*
- Persisted: specs/formulas/FORM-XXX.toml
- Lineage: source_refs: [EP-id, ES-id]
- New Compilation Transformation: FormulaCompilation (registered in FF-ONTOLOGY)

**Decision Ledger:** EL-* artifacts in ArangoDB main artifact graph
**Principle Library:** ArangoDB principles collection (primary) + DECISIONS.md (projection)
**Amendment identity:** New FN-X-V2 (successor), not same FN with new ES

## What is NOT done (next session starting points)

1. **Phase 1 implementation**: Formula compiler (EP → Gas City Formula TOML)
   is specced but not built. Start with EXECUTION-PACKET-IMPLEMENTATION-PLAN.md
   and GOVD decisions. Codex builds, GUV orchestrates.

2. **Gas City dispatch endpoint shape** (Q1-C): confirm `gc formula cook` / gc
   HTTP API endpoint shape from Gas City source before Phase 1 implementation.

3. **Fidelity Verification structural checker**: the three deterministic checks
   need implementation design (no spec written yet). Phase 2 gate.

4. **ArangoDB collections for VR-* kind=fidelity**: schema not written.
   Durable State Module is highest-ROI unbuilt component per ablation study.

5. **FormulaCompilation added to FF-ONTOLOGY**: decision approved, ontology
   file not yet updated.

6. **ADR-010 amendment**: still references six integration points and the old
   IP-3 (Factory /verify/coherence endpoint). Should be updated to five IPs
   and RELEASE step mechanism.

## Standing rules (active)

- No letter-number codes for decisions (D1, D-NEW-1 in GOVD are historical;
  do not create new coded labels)
- Spell out all acronyms on first use in every doc
- Codex owns all coding and debugging; GUV orchestrates only
- Factory ≠ Trellis; "Trellis" is a dead label — do not use
- Factory owns Specification + Amendment; Gas City owns Execution + Validation
- No invented terms without ontology grounding

## Notes
This file is manually maintained. Update as work progresses.
