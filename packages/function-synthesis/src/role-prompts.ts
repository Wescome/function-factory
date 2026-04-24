/**
 * System prompt rendering for each role in the synthesis topology.
 *
 * Renders the system prompt from role contract, WorkGraph, and
 * ActiveCandidate. Each role's prompt constrains the agent to produce
 * ONLY the role's designated output artifact, and to end with a
 * JSON footer per whitepaper section 3.
 *
 * JTBD: When a role agent is initialized, I want a system prompt
 * that encodes the role's read/write/doNot constraints and the
 * current work specification, so the agent operates within its
 * contract boundaries.
 *
 * AC 6, 7, 15, 16
 */

import type { ArchitectureCandidate, WorkGraph } from "@factory/schemas"
import type { RoleContract } from "./role-contracts.js"

/**
 * Render the system prompt for a role agent.
 */
export function renderRolePrompt(
  contract: RoleContract,
  workGraph: WorkGraph,
  candidate: ArchitectureCandidate,
): string {
  const sections: string[] = []

  // Identity
  sections.push(
    `You are the ${contract.name} role in a five-role synthesis topology.`,
    `Your output artifact is: ${contract.outputArtifact}.`,
    "",
  )

  // Read access
  sections.push(
    "## Read Access",
    `You may read the following fields: ${contract.reads.join(", ")}.`,
    "",
  )

  // Write access
  sections.push(
    "## Write Access",
    `You may write the following fields: ${contract.writes.join(", ")}.`,
    "",
  )

  // Do-not constraints
  sections.push(
    "## Constraints (DO NOT)",
    ...contract.doNot.map((d) => `- DO NOT: ${d}`),
    "",
  )

  // WorkGraph context
  sections.push(
    "## WorkGraph",
    `WorkGraph ID: ${workGraph.id}`,
    `Function ID: ${workGraph.functionId}`,
    `Nodes (${workGraph.nodes.length}):`,
    ...workGraph.nodes.map((n) => `  - ${n.id}: ${n.title} (${n.type})`),
    `Edges (${workGraph.edges.length}):`,
    ...workGraph.edges.map((e) => `  - ${e.from} -> ${e.to}`),
    "",
  )

  // Candidate context
  sections.push(
    "## Architecture Candidate",
    `Candidate ID: ${candidate.id}`,
    `Topology: ${candidate.topology.shape} — ${candidate.topology.summary}`,
    `Model Binding: ${candidate.modelBinding.bindingMode} — ${candidate.modelBinding.summary}`,
    `Tool Policy: ${candidate.toolPolicy.mode} — ${candidate.toolPolicy.summary}`,
    "",
  )

  // Output instruction
  sections.push(
    "## Output Requirements",
    `Produce ONLY the ${contract.outputArtifact} artifact.`,
    "Do not produce artifacts belonging to other roles.",
    "",
    "End your response with a JSON footer in this format:",
    "```json",
    JSON.stringify({
      role: contract.name,
      artifact: contract.outputArtifact,
      status: "complete",
    }, null, 2),
    "```",
  )

  return sections.join("\n")
}
