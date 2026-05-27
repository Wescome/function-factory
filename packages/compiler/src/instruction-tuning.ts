import {
  ArtifactId,
  DomainExecutionMode,
  InstructionTuningResult,
  TrellisExecutionPacket,
  certifyTrellisExecutionPacket,
  computeTrellisPacketHash,
  trellisContentHash,
  type ArchitectureCandidate,
  type DomainAdapterContract,
  type ExecutableSpecification,
  type InstructionTuningDiagnostic,
  type RuntimeAdmissionArtifact,
  type TrellisRuntimeProfile,
} from "@factory/schemas"

const TRANSFORMATION_VERSION = "instruction-tuning-v1"

export interface InstructionTuningInput {
  executableSpecification: ExecutableSpecification
  selectedArchitectureCandidate: ArchitectureCandidate
  runtimeAdmission: RuntimeAdmissionArtifact
  domainAdapterContract: DomainAdapterContract
  runtimeProfile: TrellisRuntimeProfile
  generatedAt: string
  executionMode?: DomainExecutionMode
}

export type InstructionTuningCompileOptions = Omit<
  InstructionTuningInput,
  "executableSpecification" | "generatedAt"
> & {
  readonly generatedAt?: string
}

type ExecutableNode = {
  id?: string
  type?: string
  title?: string
  label?: string
}

type ExecutableEdge = {
  from?: string
  to?: string
  reason?: string
  label?: string
}

export function tuneInstructions(input: Partial<InstructionTuningInput>): InstructionTuningResult {
  const missing = missingInputs(input)
  if (missing.length > 0) {
    return blocked("instruction-tuning:missing-input", `Missing required Instruction Tuning inputs: ${missing.join(", ")}.`, [], missing)
  }

  const complete = input as InstructionTuningInput
  const sourceRefs = sourceRefsFor(complete)
  const executionMode = complete.executionMode ?? "execute"
  const adapterMode = DomainExecutionMode.safeParse(executionMode)
  if (!adapterMode.success || !complete.domainAdapterContract.supportedExecutionModes.includes(executionMode)) {
    return blocked("instruction-tuning:unsupported-execution-mode", `Domain adapter ${complete.domainAdapterContract.adapterId} does not support ${executionMode}.`, sourceRefs, [executionMode])
  }
  if (complete.runtimeAdmission.decision !== "allow") {
    return blocked("instruction-tuning:runtime-admission-denied", `Runtime admission ${complete.runtimeAdmission.id} denied execution.`, sourceRefs, [complete.runtimeAdmission.id])
  }
  if (complete.selectedArchitectureCandidate.candidateStatus !== "selected") {
    return blocked("instruction-tuning:architecture-candidate-not-selected", `Architecture candidate ${complete.selectedArchitectureCandidate.id} is not selected.`, sourceRefs, [complete.selectedArchitectureCandidate.id])
  }
  if (complete.selectedArchitectureCandidate.sourceExecutableSpecificationId !== complete.executableSpecification.id) {
    return blocked(
      "instruction-tuning:architecture-candidate-source-mismatch",
      `Architecture candidate ${complete.selectedArchitectureCandidate.id} does not source ${complete.executableSpecification.id}.`,
      sourceRefs,
      [complete.selectedArchitectureCandidate.id, complete.executableSpecification.id]
    )
  }
  if (complete.runtimeAdmission.sourceExecutableSpecificationId !== complete.executableSpecification.id) {
    return blocked(
      "instruction-tuning:runtime-admission-executable-mismatch",
      `Runtime admission ${complete.runtimeAdmission.id} does not source ${complete.executableSpecification.id}.`,
      sourceRefs,
      [complete.runtimeAdmission.id, complete.executableSpecification.id]
    )
  }
  if (complete.runtimeAdmission.sourceArchitectureCandidateId !== complete.selectedArchitectureCandidate.id) {
    return blocked(
      "instruction-tuning:runtime-admission-candidate-mismatch",
      `Runtime admission ${complete.runtimeAdmission.id} does not source ${complete.selectedArchitectureCandidate.id}.`,
      sourceRefs,
      [complete.runtimeAdmission.id, complete.selectedArchitectureCandidate.id]
    )
  }

  const nodes = (complete.executableSpecification.nodes ?? []) as ExecutableNode[]
  if (nodes.length === 0) {
    return blocked("instruction-tuning:no-executable-nodes", "Executable Specification has no nodes to project into Trellis roles.", sourceRefs, [complete.executableSpecification.id])
  }

  const nodeIds = nodes.map((node, index) => node.id ?? `node-${index + 1}`)
  const duplicateNode = firstDuplicate(nodeIds)
  if (duplicateNode) {
    return blocked("instruction-tuning:duplicate-node", `Executable Specification contains duplicate node id ${duplicateNode}.`, sourceRefs, [duplicateNode])
  }

  const edges = (complete.executableSpecification.edges ?? []) as ExecutableEdge[]
  const dangling = edges.find((edge) => !edge.from || !edge.to || !nodeIds.includes(edge.from) || !nodeIds.includes(edge.to))
  if (dangling) {
    return blocked("instruction-tuning:dangling-edge", `Executable edge references missing endpoint: ${String(dangling.from)} -> ${String(dangling.to)}.`, sourceRefs, [`${String(dangling.from)}-${String(dangling.to)}`])
  }
  if (hasCycle(nodeIds, edges)) {
    return blocked("instruction-tuning:role-graph-cycle", "Executable dependencies project to a cyclic Trellis role graph.", sourceRefs, nodeIds)
  }

  const functionId = artifactIdOrDerived("FN", complete.executableSpecification.functionId ?? complete.selectedArchitectureCandidate.id)
  const intentSpecificationId = artifactIdOrDerived("IS", complete.selectedArchitectureCandidate.sourceIntentSpecificationId)
  const executableSpecificationId = artifactIdOrDerived("ES", complete.executableSpecification.id)
  const packetId = packetIdFor(functionId, executableSpecificationId, complete.selectedArchitectureCandidate.id, complete.runtimeAdmission.id)
  const runId = `trellis-${packetId}`
  const inputExecutableSpecificationHash = trellisContentHash(complete.executableSpecification)
  const adapterContractHash = trellisContentHash(complete.domainAdapterContract)
  const roleIds = nodeIds.map((id) => roleIdFor(id))
  const readBindingId = "tool-read-executable-specification"
  const evidenceIds = roleIds.map((roleId) => `evidence-${roleId}`)

  const packetDraft = TrellisExecutionPacket.parse({
    id: packetId,
    packetVersion: "trellis-packet-v1",
    functionId,
    intentSpecificationId,
    executableSpecificationId,
    selectedArchitectureCandidateId: complete.selectedArchitectureCandidate.id,
    runtimeAdmissionId: complete.runtimeAdmission.id,
    source_refs: sourceRefs,
    explicitness: "inferred",
    rationale: `Instruction Tuning projected ${executableSpecificationId} through ${complete.selectedArchitectureCandidate.id} into a Trellis Execution Packet.`,
    instructionTuning: {
      transformationVersion: TRANSFORMATION_VERSION,
      inputExecutableSpecificationHash,
      outputPacketHash: "pending",
      generatedAt: complete.generatedAt,
      deterministicInputs: [
        executableSpecificationId,
        complete.selectedArchitectureCandidate.id,
        complete.runtimeAdmission.id,
        complete.domainAdapterContract.adapterId,
        complete.runtimeProfile.profileId,
      ],
      uncertaintyRefs: [],
    },
    runtimeProfile: complete.runtimeProfile,
    adapter: {
      adapterId: complete.domainAdapterContract.adapterId,
      adapterContractRef: "CONTRACT-CODING-DOMAIN-ADAPTER",
      adapterContractHash,
      executionMode,
      requiredEffectors: [firstOrDefault(complete.domainAdapterContract.effectors, "domain-effector")],
      requiredEvidenceSources: [firstOrDefault(complete.domainAdapterContract.evidenceSources, "domain-evidence")],
      executionRequest: {
        adapterId: complete.domainAdapterContract.adapterId,
        functionId,
        intentSpecificationId,
        executableSpecificationId,
        runId,
        mode: executionMode,
        parameters: {
          runtimeProfileId: complete.runtimeProfile.profileId,
        },
      },
    },
    roles: nodes.map((node, index) => {
      const roleId = roleIds[index]!
      return {
        roleId,
        roleKind: roleKindFor(node),
        objective: node.title ?? node.label ?? `Execute ${nodeIds[index]!}`,
        inputs: [executableSpecificationId],
        outputs: [`output-${roleId}`],
        toolBindingRefs: [readBindingId],
        evidenceObligations: [evidenceIds[index]!],
        stopConditions: [`${roleId} output emitted`],
        escalationConditions: ["tool policy violation", "required evidence missing"],
        instruction: `Execute packet role ${roleId} for Executable Specification node ${nodeIds[index]!}.`,
        provenanceRefs: [executableSpecificationId, complete.selectedArchitectureCandidate.id],
      }
    }),
    roleGraph: {
      nodes: nodeIds.map((id, index) => ({
        roleId: roleIds[index]!,
        executableNodeRefs: [id],
        dependsOn: edges
          .filter((edge) => edge.to === id)
          .map((edge) => roleIdFor(edge.from!)),
        parallelizable: !edges.some((edge) => edge.to === id || edge.from === id),
      })),
      edges: edges.map((edge) => ({
        from: roleIdFor(edge.from!),
        to: roleIdFor(edge.to!),
        reason: edge.reason ?? edge.label ?? "Executable Specification dependency",
        blocking: true,
      })),
    },
    contextBundle: {
      intentSummary: `Intent ${intentSpecificationId}`,
      executableSummary: `Executable Specification ${executableSpecificationId}`,
      invariants: [],
      validationRefs: sourceRefs.filter((ref) => ref.startsWith("VAL-")),
      domainContextRefs: [complete.domainAdapterContract.adapterId],
      memoryRefs: [],
      omittedContext: [],
      provenanceRefs: [intentSpecificationId, executableSpecificationId],
    },
    toolPolicy: {
      defaultPolicy: "deny",
      bindings: [
        {
          bindingId: readBindingId,
          toolName: "readExecutableSpecification",
          roles: roleIds,
          operation: "read",
          parameterSchemaRef: "schema.tool.readExecutableSpecification",
          scopeSchemaRef: "schema.scope.executableSpecification",
          scope: [],
          constraints: ["read-only"],
          timeoutMs: 30_000,
          approvalRequired: false,
          idempotency: "not-applicable",
          evidenceRequired: false,
        },
      ],
    },
    evidencePlan: {
      requiredEvidence: roleIds.map((roleId, index) => ({
        evidenceId: evidenceIds[index]!,
        producedByRole: roleId,
        verifies: [nodeIds[index]!],
        verifierTarget: "fidelity",
        source: "trellis-role-output",
        collectionSource: "execution_artifacts",
        expectedOutcome: `${roleId} completed`,
        retentionPolicy: "retain-with-execution-result",
        hashRequired: true,
        requiredForCompletion: true,
      })),
      verificationInputs: {
        fidelity: evidenceIds,
        persistence: [],
      },
    },
    repairPolicy: {
      maxRepairAttempts: 1,
      failureClasses: [
        {
          code: "role-output-invalid",
          retryable: true,
          repairAuthority: "same-scope",
          recertificationRequired: false,
        },
        {
          code: "tool-policy-violation",
          retryable: false,
          repairAuthority: "none",
          recertificationRequired: true,
        },
        {
          code: "required-evidence-missing",
          retryable: false,
          repairAuthority: "none",
          recertificationRequired: true,
        },
      ],
      patchAuthority: [],
      escalationTarget: "human-governance",
    },
    completionContract: {
      successStatus: "succeeded",
      failureStatuses: ["failed", "blocked", "aborted"],
      requiredOutputs: roleIds.map((roleId) => `output-${roleId}`),
      requiredEvidence: evidenceIds,
      executionResultSchemaRef: "TrellisExecutionResult",
    },
    lifecyclePathway: {
      from: "in_progress",
      to: "produced",
      requiredVerification: "none",
    },
    audit: {
      packetHash: "pending",
      canonicalOrdering: [
        "source_refs",
        "roles.roleId",
        "roleGraph.nodes.roleId",
        "toolPolicy.bindings.bindingId",
        "evidencePlan.requiredEvidence.evidenceId",
      ],
      sourceVerification: [
        {
          sourceRef: executableSpecificationId,
          sourceField: "nodes",
          consumedByPacketField: ["roles", "roleGraph", "evidencePlan"],
        },
        {
          sourceRef: complete.selectedArchitectureCandidate.id,
          sourceField: "topology",
          consumedByPacketField: ["roleGraph", "repairPolicy"],
        },
      ],
      unmappedExecutableRefs: [],
      policyWarnings: [],
    },
  })

  const hash = computeTrellisPacketHash(packetDraft)
  const packet = TrellisExecutionPacket.parse({
    ...packetDraft,
    instructionTuning: {
      ...packetDraft.instructionTuning,
      outputPacketHash: hash,
    },
    audit: {
      ...packetDraft.audit,
      packetHash: hash,
    },
  })
  const certification = certifyTrellisExecutionPacket(packet)
  if (!certification.valid) {
    return {
      status: "blocked",
      diagnostics: certification.diagnostics.map((message) => diagnostic("instruction-tuning:certification-failed", message, sourceRefs, true)),
      uncertaintyEntries: ["UNC-INSTRUCTION-TUNING-CERTIFICATION-FAILED"],
    }
  }

  return InstructionTuningResult.parse({
    status: "emitted",
    packet,
    diagnostics: [],
  })
}

function missingInputs(input: Partial<InstructionTuningInput>): string[] {
  const missing: string[] = []
  if (!input.executableSpecification) missing.push("executableSpecification")
  if (!input.selectedArchitectureCandidate) missing.push("selectedArchitectureCandidate")
  if (!input.runtimeAdmission) missing.push("runtimeAdmission")
  if (!input.domainAdapterContract) missing.push("domainAdapterContract")
  if (!input.runtimeProfile) missing.push("runtimeProfile")
  if (!input.generatedAt) missing.push("generatedAt")
  return missing
}

function blocked(code: string, message: string, sourceRefs: ArtifactId[], uncertaintySeeds: readonly string[]): InstructionTuningResult {
  const refs = sourceRefs.length > 0 ? sourceRefs : ["IS-MISSING-CONTEXT" as ArtifactId]
  return InstructionTuningResult.parse({
    status: "blocked",
    diagnostics: [diagnostic(code, message, refs, true)],
    uncertaintyEntries: uncertaintySeeds.map((seed) => uncertaintyId(seed)),
  })
}

function diagnostic(code: string, message: string, sourceRefs: ArtifactId[], blocking: boolean): InstructionTuningDiagnostic {
  return {
    code,
    severity: blocking ? "blocking" : "warning",
    blocking,
    source_refs: sourceRefs,
    message,
  }
}

function uncertaintyId(seed: string): string {
  return `UNC-${seed.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "INSTRUCTION-TUNING"}`
}

function sourceRefsFor(input: InstructionTuningInput): ArtifactId[] {
  return uniqueArtifactIds([
    input.selectedArchitectureCandidate.sourceIntentSpecificationId,
    input.executableSpecification.id,
    input.selectedArchitectureCandidate.id,
    input.runtimeAdmission.id,
    "CONTRACT-CODING-DOMAIN-ADAPTER",
    ...(input.executableSpecification.source_refs ?? []),
  ])
}

function packetIdFor(functionId: ArtifactId, executableSpecificationId: ArtifactId, candidateId: ArtifactId, admissionId: ArtifactId): ArtifactId {
  return ArtifactId.parse(`EP-${subject(functionId)}-${subject(executableSpecificationId)}-${subject(candidateId)}-${subject(admissionId)}`)
}

function artifactIdOrDerived(prefix: "FN" | "IS" | "ES", candidate: string): ArtifactId {
  const parsed = ArtifactId.safeParse(candidate)
  if (parsed.success && candidate.startsWith(`${prefix}-`)) return parsed.data
  return ArtifactId.parse(`${prefix}-${subject(candidate)}`)
}

function uniqueArtifactIds(values: readonly string[]): ArtifactId[] {
  const out: ArtifactId[] = []
  for (const value of values) {
    const parsed = ArtifactId.safeParse(value)
    if (parsed.success && !out.includes(parsed.data)) out.push(parsed.data)
  }
  return out
}

function subject(value: string): string {
  return value
    .replace(/^[A-Z]+-/, "")
    .toUpperCase()
    .replace(/[^A-Z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "UNKNOWN"
}

function roleIdFor(nodeId: string): string {
  return `role-${nodeId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "node"}`
}

function roleKindFor(node: ExecutableNode): string {
  return (node.type ?? "executor").toLowerCase().replace(/[^a-z0-9-]+/g, "-") || "executor"
}

function firstDuplicate(values: readonly string[]): string | null {
  const seen = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) return value
    seen.add(value)
  }
  return null
}

function hasCycle(nodes: readonly string[], edges: readonly ExecutableEdge[]): boolean {
  const outgoing = new Map(nodes.map((node) => [node, [] as string[]]))
  for (const edge of edges) {
    if (edge.from && edge.to) outgoing.get(edge.from)?.push(edge.to)
  }
  const visiting = new Set<string>()
  const visited = new Set<string>()

  const visit = (node: string): boolean => {
    if (visiting.has(node)) return true
    if (visited.has(node)) return false
    visiting.add(node)
    for (const next of outgoing.get(node) ?? []) {
      if (visit(next)) return true
    }
    visiting.delete(node)
    visited.add(node)
    return false
  }

  return nodes.some((node) => visit(node))
}

function firstOrDefault(values: readonly string[], fallback: string): string {
  return values[0] ?? fallback
}

function idOrJson(value: Record<string, unknown>): string {
  return typeof value.id === "string" ? value.id : JSON.stringify(value)
}
