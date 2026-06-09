import { describe, expect, it } from "vitest"
import {
  TrellisExecutionPacket,
  certifyTrellisExecutionPacket,
  computeTrellisPacketHash,
  type TrellisExecutionPacket as TrellisExecutionPacketType,
} from "./trellis-execution-packet.js"

function makePacket(overrides: Partial<TrellisExecutionPacketType> = {}): TrellisExecutionPacketType {
  const packet = TrellisExecutionPacket.parse({
    id: "TEP-FN-META-EXAMPLE-ES-META-EXAMPLE-AC-META-EXAMPLE",
    packetVersion: "trellis-packet-v1",
    functionId: "FN-META-EXAMPLE",
    intentSpecificationId: "IS-META-EXAMPLE",
    executableSpecificationId: "ES-META-EXAMPLE",
    selectedArchitectureCandidateId: "AC-META-EXAMPLE",
    runtimeAdmissionId: "RAD-META-EXAMPLE",
    source_refs: [
      "IS-META-EXAMPLE",
      "ES-META-EXAMPLE",
      "AC-META-EXAMPLE",
      "RAD-META-EXAMPLE",
      "CONTRACT-CODING-DOMAIN-ADAPTER",
    ],
    explicitness: "inferred",
    rationale: "Instruction Tuning packet derived from a Coherence Verification-passed Executable Specification.",
    instructionTuning: {
      transformationVersion: "instruction-tuning-v1",
      inputExecutableSpecificationHash: "hash-executable",
      outputPacketHash: "pending",
      generatedAt: "2026-05-10T21:40:00.000Z",
      deterministicInputs: ["ES-META-EXAMPLE", "AC-META-EXAMPLE", "RAD-META-EXAMPLE"],
      uncertaintyRefs: [],
    },
    runtimeProfile: {
      profileId: "trellis-runtime.coding.v1",
      roleCatalogRef: "role-catalog.coding.v1",
      toolCatalogRef: "tool-catalog.coding.v1",
      memoryCatalogRef: "memory-catalog.coding.v1",
      policyCatalogRef: "policy-catalog.coding.v1",
      suppliedBy: "trellis-runtime",
    },
    adapter: {
      adapterId: "adapter.coding",
      adapterContractRef: "CONTRACT-CODING-DOMAIN-ADAPTER",
      adapterContractHash: "hash-adapter",
      executionMode: "execute",
      requiredEffectors: ["file-edit"],
      requiredEvidenceSources: ["test-result"],
      executionRequest: {
        adapterId: "adapter.coding",
        functionId: "FN-META-EXAMPLE",
        intentSpecificationId: "IS-META-EXAMPLE",
        executableSpecificationId: "ES-META-EXAMPLE",
        runId: "synthesis-ES-META-EXAMPLE",
        mode: "execute",
        parameters: {},
      },
    },
    roles: [
      {
        roleId: "planner",
        roleKind: "planner",
        objective: "Plan execution.",
        inputs: ["ES-META-EXAMPLE"],
        outputs: ["PLAN-META-EXAMPLE"],
        toolBindingRefs: ["tool-read-executable"],
        evidenceObligations: ["evidence-plan"],
        stopConditions: ["plan emitted"],
        escalationConditions: [],
        instruction: "Produce the execution plan from the packet context.",
        provenanceRefs: ["ES-META-EXAMPLE"],
      },
    ],
    roleGraph: {
      nodes: [
        {
          roleId: "planner",
          executableNodeRefs: ["node-plan"],
          dependsOn: [],
          parallelizable: false,
        },
      ],
      edges: [],
    },
    contextBundle: {
      intentSummary: "Example intent.",
      executableSummary: "Example executable specification.",
      invariants: ["INV-META-EXAMPLE"],
      validationRefs: ["VAL-META-EXAMPLE"],
      domainContextRefs: [],
      memoryRefs: [],
      omittedContext: [],
      provenanceRefs: ["IS-META-EXAMPLE", "ES-META-EXAMPLE"],
    },
    toolPolicy: {
      defaultPolicy: "deny",
      bindings: [
        {
          bindingId: "tool-read-executable",
          toolName: "readExecutableSpecification",
          roles: ["planner"],
          operation: "read",
          parameterSchemaRef: "schema.tool.readExecutableSpecification",
          scopeSchemaRef: "schema.scope.readonly",
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
      requiredEvidence: [
        {
          evidenceId: "evidence-plan",
          producedByRole: "planner",
          verifies: ["VAL-META-EXAMPLE"],
          verifierTarget: "fidelity",
          source: "trellis-role-output",
          collectionSource: "execution_artifacts",
          expectedOutcome: "plan emitted",
          retentionPolicy: "retain-with-execution-result",
          hashRequired: true,
          requiredForCompletion: true,
        },
      ],
      verificationInputs: {
        fidelity: ["evidence-plan"],
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
      ],
      patchAuthority: [],
      escalationTarget: "human-governance",
    },
    completionContract: {
      successStatus: "succeeded",
      failureStatuses: ["failed", "blocked"],
      requiredOutputs: ["PLAN-META-EXAMPLE"],
      requiredEvidence: ["evidence-plan"],
      executionResultSchemaRef: "TrellisExecutionResult",
    },
    lifecyclePathway: {
      from: "in_progress",
      to: "produced",
      requiredVerification: "none",
    },
    audit: {
      packetHash: "pending",
      canonicalOrdering: ["roles.roleId", "toolPolicy.bindings.bindingId"],
      sourceVerification: [
        {
          sourceRef: "ES-META-EXAMPLE",
          sourceField: "nodes",
          consumedByPacketField: ["roles", "roleGraph"],
        },
      ],
      unmappedExecutableRefs: [],
      policyWarnings: [],
    },
    ...overrides,
  })
  const hash = computeTrellisPacketHash(packet)
  return TrellisExecutionPacket.parse({
    ...packet,
    instructionTuning: {
      ...packet.instructionTuning,
      outputPacketHash: hash,
    },
    audit: {
      ...packet.audit,
      packetHash: hash,
    },
  })
}

describe("TrellisExecutionPacket", () => {
  it("parses a valid lineage-bearing packet", () => {
    const packet = makePacket()

    expect(packet.id).toMatch(/^TEP-/)
    expect(packet.source_refs).toContain("ES-META-EXAMPLE")
    expect(certifyTrellisExecutionPacket(packet).valid).toBe(true)
  })

  it("rejects non-TEP packet ids", () => {
    expect(() => makePacket({ id: "ES-META-EXAMPLE" } as Partial<TrellisExecutionPacketType>)).toThrow()
  })

  it("rejects packets missing selected ArchitectureCandidate lineage", () => {
    expect(() =>
      makePacket({
        selectedArchitectureCandidateId: "FN-META-EXAMPLE",
      } as Partial<TrellisExecutionPacketType>)
    ).toThrow()
  })

  it("rejects write tool bindings with empty scope", () => {
    const packet = makePacket()
    expect(() =>
      TrellisExecutionPacket.parse({
        ...packet,
        toolPolicy: {
          defaultPolicy: "deny",
          bindings: [
            {
              ...packet.toolPolicy.bindings[0]!,
              operation: "write",
              scope: [],
            },
          ],
        },
      })
    ).toThrow()
  })

  it("certification rejects missing evidence producers", () => {
    const packet = makePacket()
    const result = certifyTrellisExecutionPacket({
      ...packet,
      evidencePlan: {
        ...packet.evidencePlan,
        requiredEvidence: [
          {
            ...packet.evidencePlan.requiredEvidence[0]!,
            producedByRole: "missing-role",
          },
        ],
      },
    })

    expect(result.valid).toBe(false)
    expect(result.diagnostics.join("\n")).toContain("missing-role")
  })

  it("certification rejects stale packet hashes", () => {
    const packet = makePacket()
    const result = certifyTrellisExecutionPacket({
      ...packet,
      audit: {
        ...packet.audit,
        packetHash: "stale",
      },
    })

    expect(result.valid).toBe(false)
    expect(result.diagnostics.join("\n")).toContain("packetHash")
  })

  it("certification rejects unmapped executable refs", () => {
    const packet = makePacket()
    const result = certifyTrellisExecutionPacket({
      ...packet,
      audit: {
        ...packet.audit,
        unmappedExecutableRefs: ["node-missing"],
      },
    })

    expect(result.valid).toBe(false)
    expect(result.diagnostics.join("\n")).toContain("unmappedExecutableRefs")
  })

  it("allows execution evidence to carry packet identity", () => {
    const packet = makePacket()
    const evidence = {
      adapterId: "adapter.coding",
      executableSpecificationId: packet.executableSpecificationId,
      runId: packet.adapter.executionRequest.runId,
      status: "succeeded",
      evidenceRefs: ["evidence-plan"],
      observationSummary: "Packet-bound execution succeeded.",
      packetId: packet.id,
      packetHash: packet.audit.packetHash,
    }

    expect(packet.adapter.executionRequest.executableSpecificationId).toBe("ES-META-EXAMPLE")
    expect(evidence.packetId).toBe(packet.id)
  })
})
