import type { ProposalAuthoringContext, RenderedPrd } from "./types.js"
import { prdIdFromFunctionProposalId } from "./ids.js"

/**
 * Deterministic PRD renderer for the current narrow self-bootstrapping bridge.
 *
 * Supported proposals:
 * - FP-META-CAPABILITY-DELTA-ENGINE
 * - FP-META-SEMANTIC-REVIEW-EXECUTION
 * - FP-META-ARCHITECTURE-CANDIDATE-EXECUTION
 *
 * All other proposals must fail explicitly.
 */
export function renderPrdFromFunctionProposal(
  context: ProposalAuthoringContext
): RenderedPrd {
  const { proposal, sourceCapabilityId, sourceFunctionId, sourceRefs } = context
  const prdId = prdIdFromFunctionProposalId(proposal.id)

  if (proposal.id === "FP-META-CAPABILITY-DELTA-ENGINE") {
    const title = "Capability Delta Execution Engine"
    const markdown = [
      "---",
      `id: ${prdId}`,
      "source_refs:",
      ...sourceRefs.map((r) => `  - ${r}`),
      "explicitness: inferred",
      "rationale: >",
      "  Derived deterministically from FP-META-CAPABILITY-DELTA-ENGINE and its upstream lineage.",
      `sourceCapabilityId: ${sourceCapabilityId}`,
      `sourceFunctionId: ${sourceFunctionId}`,
      `title: ${title}`,
      "---",
      "",
      `# ${title}`,
      "",
      "## Problem",
      "The repo can now compute capability delta and emit FunctionProposal demand in Stage 4, but there is no dedicated execution engine artifact that computes capability delta as a first-class bootstrap Function from bounded repo evidence.",
      "",
      "## Goal",
      "Implement a deterministic capability-delta execution engine that consumes a BusinessCapability and RepoInventory, computes a CapabilityDelta for supported bootstrap capabilities, and produces reviewable downstream proposal demand without modifying compiler behavior.",
      "",
      "## Constraints",
      "Must remain separate from Stage 5 compiler logic.",
      "",
      "Must preserve lineage and explicit rationale in emitted artifacts.",
      "",
      "Must be deterministic and rule-based.",
      "",
      "Must not use LLM-based inference in the first implementation.",
      "",
      "## Acceptance Criteria",
      "1. The engine accepts the supported bootstrap capability and a bounded RepoInventory input.",
      "2. The engine computes a deterministic CapabilityDelta with explicit findings and overallStatus.",
      "3. The engine emits downstream typed FunctionProposal demand from the computed delta.",
      "4. The implementation fails explicitly for unsupported capabilities in the initial narrow version.",
      "5. The implementation preserves lineage and explicitness in emitted artifacts.",
      "",
      "## Success Metrics",
      "Deterministic delta classification across repeated runs for supported bootstrap capabilities.",
      "",
      "Stable and typed FunctionProposal emission from computed delta findings.",
      "",
      "Zero compiler behavior changes required to adopt the produced PRD.",
      "",
      "## Out of Scope",
      "Generalized support for all capability families.",
      "",
      "LLM-based repo interpretation or proposal generation.",
      "",
      "Runtime execution, Gate 2, Gate 3, and assurance propagation.",
    ].join("\n")

    return { id: prdId, filename: `${prdId}.md`, markdown }
  }

  if (proposal.id === "FP-META-SEMANTIC-REVIEW-EXECUTION") {
    const title = "Semantic Review Execution Engine"
    const markdown = [
      "---",
      `id: ${prdId}`,
      "source_refs:",
      ...sourceRefs.map((r) => `  - ${r}`),
      "explicitness: inferred",
      "rationale: >",
      "  Derived deterministically from FP-META-SEMANTIC-REVIEW-EXECUTION and its upstream lineage.",
      `sourceCapabilityId: ${sourceCapabilityId}`,
      `sourceFunctionId: ${sourceFunctionId}`,
      `title: ${title}`,
      "---",
      "",
      `# ${title}`,
      "",
      "## Problem",
      "Gate 1 verifies structural completeness, but the current repo has no semantic review execution step capable of blocking structurally valid yet conceptually invalid PRDs before WorkGraph emission.",
      "",
      "## Goal",
      "Implement a deterministic semantic review execution engine that consumes a PRDDraft, Gate1Report, and doctrine inputs, produces a semantic review verdict, and preserves fail-closed behavior before WorkGraph emission without modifying compiler behavior in this step.",
      "",
      "## Constraints",
      "Must be fail-closed.",
      "",
      "Must not weaken Gate 1 structural coverage discipline.",
      "",
      "Must remain deterministic.",
      "",
      "Must not use LLM-based inference in the first implementation.",
      "",
      "## Acceptance Criteria",
      "1. The engine accepts the supported semantic review inputs in the initial narrow version.",
      "2. The engine produces a semantic review verdict suitable for later integration.",
      "3. The engine blocks unsupported or invalid review cases explicitly.",
      "4. The implementation preserves lineage and explicitness in emitted artifacts.",
      "5. The implementation remains separate from Stage 5 compiler logic in this first bridge increment.",
      "",
      "## Success Metrics",
      "Deterministic semantic review rendering outputs across repeated runs.",
      "",
      "Stable and reviewable verdict structure for the supported semantic review path.",
      "",
      "Zero compiler behavior changes required to adopt the produced PRD artifact.",
      "",
      "## Out of Scope",
      "Generalized support for all semantic review proposal families.",
      "",
      "LLM-based semantic analysis.",
      "",
      "Runtime execution, Gate 2, Gate 3, and assurance propagation.",
    ].join("\n")

    return { id: prdId, filename: `${prdId}.md`, markdown }
  }

  if (proposal.id === "FP-META-ARCHITECTURE-CANDIDATE-EXECUTION") {
    const title = "Architecture Candidate Execution Engine"
    const markdown = [
      "---",
      `id: ${prdId}`,
      "source_refs:",
      ...sourceRefs.map((r) => `  - ${r}`),
      "explicitness: inferred",
      "rationale: >",
      "  Derived deterministically from FP-META-ARCHITECTURE-CANDIDATE-EXECUTION and its upstream lineage.",
      `sourceCapabilityId: ${sourceCapabilityId}`,
      `sourceFunctionId: ${sourceFunctionId}`,
      `title: ${title}`,
      "---",
      "",
      `# ${title}`,
      "",
      "## Problem",
      "The current Stage 5 compiler emits WorkGraph artifacts, but it does not emit ArchitectureCandidate artifacts that make the execution arrangement explicit before runtime exists.",
      "",
      "## Goal",
      "Implement a deterministic architecture-candidate execution engine that renders explicit candidate artifacts alongside WorkGraphs, capturing candidate execution arrangement without modifying compiler behavior in this bridge step.",
      "",
      "## Constraints",
      "Must remain separate from Stage 5 compiler logic in the first implementation.",
      "",
      "Must preserve lineage and explicit rationale in emitted artifacts.",
      "",
      "Must keep ArchitectureCandidate artifacts separately addressable from WorkGraphs.",
      "",
      "Must not use LLM-based inference in the first implementation.",
      "",
      "## Acceptance Criteria",
      "1. The engine accepts the supported architecture-candidate inputs in the initial narrow version.",
      "2. The engine renders an explicit architecture-candidate execution artifact plan suitable for later Stage 5 integration.",
      "3. The implementation preserves lineage and explicitness in emitted artifacts.",
      "4. The implementation fails explicitly for unsupported proposal types in the current narrow bridge.",
      "5. The implementation remains deterministic across repeated runs.",
      "",
      "## Success Metrics",
      "Deterministic architecture-candidate rendering outputs across repeated runs.",
      "",
      "Stable candidate execution structure for the supported architecture-candidate path.",
      "",
      "Zero compiler behavior changes required to adopt the produced PRD artifact.",
      "",
      "## Out of Scope",
      "Generalized support for all architecture-candidate proposal families.",
      "",
      "Runtime execution and candidate selection at runtime.",
      "",
      "LLM-based execution-arrangement synthesis.",
    ].join("\n")
    return { id: prdId, filename: `${prdId}.md`, markdown }
  }

  throw new Error(
    "Initial PRD authoring bridge supports only FP-META-CAPABILITY-DELTA-ENGINE, FP-META-SEMANTIC-REVIEW-EXECUTION, and FP-META-ARCHITECTURE-CANDIDATE-EXECUTION"
  )
}
