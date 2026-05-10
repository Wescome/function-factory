import { describe, expect, it } from "vitest"
import {
  DomainAdapterContract,
  DomainExecutionEvidence,
  DomainExecutionRequest,
} from "./domain-adapter.js"

describe("DomainAdapterContract", () => {
  it("keeps coding terms inside adapter mappings instead of kernel concepts", () => {
    const parsed = DomainAdapterContract.parse({
      adapterId: "adapter.coding",
      domain: "coding",
      substrate: "git-github-ci",
      substrateTermMappings: [
        {
          adapterTerm: "pull request",
          kernelConcept: "handoff_artifact",
          description: "Coding-domain handoff for review and merge.",
        },
        {
          adapterTerm: "CI check",
          kernelConcept: "verification_evidence_source",
          description: "Coding-domain evidence source for tests and typecheck.",
        },
      ],
      supportedExecutionModes: ["simulate", "execute"],
      evidenceSources: ["test-result", "typecheck-result"],
      effectors: ["file-edit", "git-push"],
    })

    expect(parsed.substrateTermMappings.map((mapping) => mapping.adapterTerm)).toEqual([
      "pull request",
      "CI check",
    ])
    expect(parsed.substrateTermMappings.map((mapping) => mapping.kernelConcept)).toEqual([
      "handoff_artifact",
      "verification_evidence_source",
    ])
  })

  it("rejects adapter contracts without an explicit substrate mapping", () => {
    expect(() =>
      DomainAdapterContract.parse({
        adapterId: "adapter.coding",
        domain: "coding",
        substrate: "git-github-ci",
        substrateTermMappings: [],
        supportedExecutionModes: ["simulate"],
        evidenceSources: ["test-result"],
        effectors: ["file-edit"],
      })
    ).toThrow()
  })
})

describe("DomainExecutionRequest", () => {
  it("uses kernel names for execution input identity", () => {
    const parsed = DomainExecutionRequest.parse({
      adapterId: "adapter.coding",
      functionId: "FN-META-EXAMPLE",
      intentSpecificationId: "IS-META-EXAMPLE",
      executableSpecificationId: "ES-META-EXAMPLE",
      runId: "run-1",
      mode: "simulate",
      parameters: {
        target: "dry-run",
      },
    })

    expect(parsed.executableSpecificationId).toBe("ES-META-EXAMPLE")
  })
})

describe("DomainExecutionEvidence", () => {
  it("records domain adapter evidence with kernel identity fields", () => {
    const parsed = DomainExecutionEvidence.parse({
      adapterId: "adapter.coding",
      executableSpecificationId: "ES-META-EXAMPLE",
      runId: "run-1",
      status: "succeeded",
      evidenceRefs: ["ci:test:pass", "ci:typecheck:pass"],
      observationSummary: "Coding adapter execution produced passing evidence.",
    })

    expect(parsed.status).toBe("succeeded")
    expect(parsed.evidenceRefs).toHaveLength(2)
    expect(parsed.executableSpecificationId).toBe("ES-META-EXAMPLE")
  })

  it("can bind execution evidence to a Trellis packet", () => {
    const parsed = DomainExecutionEvidence.parse({
      adapterId: "adapter.coding",
      executableSpecificationId: "ES-META-EXAMPLE",
      runId: "run-1",
      status: "succeeded",
      evidenceRefs: ["ci:test:pass"],
      observationSummary: "Coding adapter execution produced passing evidence.",
      packetId: "TEP-FN-META-EXAMPLE-ES-META-EXAMPLE",
      packetHash: "hash-packet",
    })

    expect(parsed.packetId).toBe("TEP-FN-META-EXAMPLE-ES-META-EXAMPLE")
    expect(parsed.packetHash).toBe("hash-packet")
  })
})
