import type { ProposalAuthoringContext, RenderedPrd } from "./types.js"
import { prdIdFromFunctionProposalId } from "./ids.js"

/**
 * Narrow initial implementation target:
 * - supports only FP-META-CAPABILITY-DELTA-ENGINE
 * - renders compiler-ready markdown in the shape expected by Pass 0
 */
export function renderPrdFromFunctionProposal(
  context: ProposalAuthoringContext
): RenderedPrd {
  const { proposal, sourceCapabilityId, sourceFunctionId, sourceRefs } = context

  if (proposal.id !== "FP-META-CAPABILITY-DELTA-ENGINE") {
    throw new Error(
      "Initial PRD authoring bridge supports only FP-META-CAPABILITY-DELTA-ENGINE"
    )
  }

  const prdId = prdIdFromFunctionProposalId(proposal.id)
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

  return {
    id: prdId,
    filename: `${prdId}.md`,
    markdown,
  }
}
