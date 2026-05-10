import { tuneInstructions } from '@factory/compiler/instruction-tuning'
import {
  ArchitectureCandidate,
  ArtifactId,
  CodingDomainAdapterContract,
  CodingTrellisRuntimeProfile,
  ExecutableSpecification,
  RuntimeAdmissionArtifact,
  type InstructionTuningResult,
} from '@factory/schemas'
import type { PipelineExecutableSpecification } from './coordinator/state'

export interface PipelineInstructionTuningInput {
  executableSpecificationId: string
  executableSpecification: PipelineExecutableSpecification | Record<string, unknown>
  proposal: Record<string, unknown>
  generatedAt: string
}

export function buildTrellisPacketForSynthesis(
  input: PipelineInstructionTuningInput,
): InstructionTuningResult {
  const executableSpecification = projectExecutableSpecification(
    input.executableSpecificationId,
    input.executableSpecification,
    input.proposal,
  )
  const intentSpecificationId = intentSpecificationIdFor(executableSpecification, input.proposal)
  const subject = subjectFor(executableSpecification.id)

  const selectedArchitectureCandidate = ArchitectureCandidate.parse({
    id: ArtifactId.parse(`AC-${subject}`),
    sourcePrdId: intentSpecificationId,
    sourceExecutableSpecificationId: executableSpecification.id,
    candidateStatus: 'selected',
    topology: {
      shape: topologyShape(executableSpecification.nodes.length, executableSpecification.edges.length),
      summary: `Selected Trellis topology for ${executableSpecification.id}.`,
    },
    modelBinding: {
      bindingMode: 'policy_selected',
      summary: 'Trellis runtime profile controls model binding.',
    },
    toolPolicy: {
      mode: 'restricted',
      summary: 'Trellis Execution Packet tool bindings mediate all domain actions.',
    },
    convergencePolicy: {
      mode: 'gated_iteration',
      summary: 'Repair attempts are limited by packet policy and evidence recertification.',
    },
    source_refs: [intentSpecificationId, executableSpecification.id],
    explicitness: 'inferred',
    rationale: 'Derived during pipeline Instruction Tuning from the selected Executable Specification.',
  })

  const runtimeAdmission = RuntimeAdmissionArtifact.parse({
    id: ArtifactId.parse(`RAD-${subject}`),
    sourceExecutableSpecificationId: executableSpecification.id,
    sourceArchitectureCandidateId: selectedArchitectureCandidate.id,
    sourceSelectionId: ArtifactId.parse(`ACS-${subject}`),
    decision: 'allow',
    reason: 'Pipeline Coherence Verification passed; packet is admitted for Agent Call execution.',
    source_refs: [
      executableSpecification.id,
      selectedArchitectureCandidate.id,
    ],
    explicitness: 'inferred',
    rationale: 'Derived from successful pipeline verification immediately before synthesis dispatch.',
  })

  return tuneInstructions({
    executableSpecification,
    selectedArchitectureCandidate,
    runtimeAdmission,
    domainAdapterContract: CodingDomainAdapterContract,
    runtimeProfile: CodingTrellisRuntimeProfile,
    generatedAt: input.generatedAt,
    executionMode: 'execute',
  })
}

function projectExecutableSpecification(
  executableSpecificationId: string,
  raw: PipelineExecutableSpecification | Record<string, unknown>,
  proposal: Record<string, unknown>,
): ExecutableSpecification {
  const id = artifactIdOrDerived('WG', stringField(raw, '_key') ?? stringField(raw, 'id') ?? executableSpecificationId)
  const sourceRefs = sourceRefsFor(raw, proposal, id)
  const nodes = projectNodes(raw)
  const edges = projectEdges(raw, new Set(nodes.map((node) => node.id)))

  return ExecutableSpecification.parse({
    id,
    functionId: artifactIdOrDerived('FN', stringField(raw, 'functionId') ?? stringField(proposal, '_key') ?? id),
    nodes,
    edges,
    source_refs: sourceRefs,
    explicitness: 'inferred',
    rationale: 'Projected from the pipeline Executable Specification into canonical schema form for Trellis Instruction Tuning.',
  })
}

function projectNodes(raw: Record<string, unknown>): Array<{
  id: string
  type: 'interface' | 'execution' | 'control' | 'evidence'
  title: string
  implements?: string
}> {
  const rawNodes = arrayOfRecords(raw.nodes)
  if (rawNodes.length > 0) {
    return rawNodes.map((node, index) => {
      const implementsId = artifactIdField(node, 'implements')
      return {
        id: stringField(node, 'id') ?? `node-${index + 1}`,
        type: executableNodeType(stringField(node, 'type')),
        title: stringField(node, 'title') ?? stringField(node, 'label') ?? `Node ${index + 1}`,
        ...(implementsId ? { implements: implementsId } : {}),
      }
    })
  }

  const atoms = arrayOfRecords(raw.atoms)
  if (atoms.length > 0) {
    return atoms.map((atom, index) => {
      const implementsId = artifactIdField(atom, 'implements')
      return {
        id: stringField(atom, 'id') ?? stringField(atom, '_key') ?? `atom-${index + 1}`,
        type: executableNodeType(stringField(atom, 'type')),
        title: stringField(atom, 'title') ?? stringField(atom, 'description') ?? `Atom ${index + 1}`,
        ...(implementsId ? { implements: implementsId } : {}),
      }
    })
  }

  return [{
    id: 'synthesis',
    type: 'execution',
    title: 'Execute synthesis',
  }]
}

function projectEdges(
  raw: Record<string, unknown>,
  nodeIds: ReadonlySet<string>,
): Array<{
  from: string
  to: string
  condition?: string
  dependencyType?: 'blocks' | 'constrains' | 'implements' | 'validates' | 'informs'
}> {
  const sourceEdges = arrayOfRecords(raw.edges).length > 0
    ? arrayOfRecords(raw.edges)
    : arrayOfRecords(raw.dependencies)

  return sourceEdges.flatMap((edge) => {
    const from = stringField(edge, 'from')
    const to = stringField(edge, 'to')
    const condition = stringField(edge, 'condition')
    if (!from || !to || !nodeIds.has(from) || !nodeIds.has(to)) return []
    return [{
      from,
      to,
      ...(condition ? { condition } : {}),
      dependencyType: dependencyTypeFor(stringField(edge, 'dependencyType') ?? stringField(edge, 'type')),
    }]
  })
}

function sourceRefsFor(
  raw: Record<string, unknown>,
  proposal: Record<string, unknown>,
  executableSpecificationId: ArtifactId,
): ArtifactId[] {
  const refs = [
    ...artifactIdsFromArray(raw.source_refs),
    ...artifactIdsFromArray(raw.sourceRefs),
    artifactIdOrDerived('PRD', stringField(raw, 'prdId') ?? prdIdFromProposal(proposal) ?? executableSpecificationId),
  ]
  return [...new Set(refs)]
}

function intentSpecificationIdFor(
  executableSpecification: ExecutableSpecification,
  proposal: Record<string, unknown>,
): ArtifactId {
  const prdRef = executableSpecification.source_refs.find((ref) => ref.startsWith('PRD-'))
  if (prdRef) return prdRef
  return artifactIdOrDerived('PRD', prdIdFromProposal(proposal) ?? executableSpecification.id)
}

function prdIdFromProposal(proposal: Record<string, unknown>): string | null {
  const prd = proposal.prd
  if (prd && typeof prd === 'object') {
    return stringField(prd as Record<string, unknown>, '_key') ?? stringField(prd as Record<string, unknown>, 'id')
  }
  return null
}

function topologyShape(nodeCount: number, edgeCount: number): 'single_node' | 'linear_chain' | 'fan_out' | 'other' {
  if (nodeCount <= 1) return 'single_node'
  if (edgeCount === nodeCount - 1) return 'linear_chain'
  if (edgeCount > nodeCount - 1) return 'fan_out'
  return 'other'
}

function executableNodeType(candidate: string | null): 'interface' | 'execution' | 'control' | 'evidence' {
  if (candidate === 'interface' || candidate === 'control' || candidate === 'evidence' || candidate === 'execution') {
    return candidate
  }
  if (candidate === 'validation' || candidate === 'test') return 'evidence'
  if (candidate === 'config' || candidate === 'routing') return 'control'
  return 'execution'
}

function dependencyTypeFor(candidate: string | null): 'blocks' | 'constrains' | 'implements' | 'validates' | 'informs' {
  if (
    candidate === 'blocks'
    || candidate === 'constrains'
    || candidate === 'implements'
    || candidate === 'validates'
    || candidate === 'informs'
  ) {
    return candidate
  }
  return 'informs'
}

function artifactIdsFromArray(value: unknown): ArtifactId[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (typeof item !== 'string') return []
    const candidate = item.includes(':') ? item.split(':').at(-1) ?? item : item
    const parsed = ArtifactId.safeParse(candidate)
    return parsed.success ? [parsed.data] : []
  })
}

function artifactIdField(record: Record<string, unknown>, key: string): ArtifactId | null {
  const value = stringField(record, key)
  if (!value) return null
  const parsed = ArtifactId.safeParse(value)
  return parsed.success ? parsed.data : null
}

function artifactIdOrDerived(prefix: 'FN' | 'PRD' | 'WG', candidate: string): ArtifactId {
  const parsed = ArtifactId.safeParse(candidate)
  if (parsed.success && candidate.startsWith(`${prefix}-`)) return parsed.data
  return ArtifactId.parse(`${prefix}-${subjectFor(candidate)}`)
}

function subjectFor(value: string): string {
  return value
    .replace(/^[A-Za-z]+-/, '')
    .toUpperCase()
    .replace(/[^A-Z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'UNKNOWN'
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function arrayOfRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => item !== null && typeof item === 'object' && !Array.isArray(item))
    : []
}
