import { describe, expect, it } from "vitest"
import { canonicalTrellisJson, trellisContentHash } from "./trellis-canonical-json.js"

describe("canonicalTrellisJson", () => {
  it("sorts object keys and normalizes strings", () => {
    expect(canonicalTrellisJson({ b: "e\u0301", a: 1 })).toBe('{"a":1,"b":"é"}')
  })

  it("sorts packet arrays by declared stable keys", () => {
    const left = {
      roles: [
        { roleId: "tester", instruction: "test" },
        { roleId: "planner", instruction: "plan" },
      ],
      source_refs: ["WG-META-EXAMPLE", "PRD-META-EXAMPLE"],
    }
    const right = {
      source_refs: ["PRD-META-EXAMPLE", "WG-META-EXAMPLE"],
      roles: [
        { instruction: "plan", roleId: "planner" },
        { instruction: "test", roleId: "tester" },
      ],
    }

    expect(canonicalTrellisJson(left)).toBe(canonicalTrellisJson(right))
    expect(trellisContentHash(left)).toBe(trellisContentHash(right))
  })

  it("excludes generatedAt and packet hash fields from content hash", () => {
    const left = {
      instructionTuning: {
        generatedAt: "2026-05-10T00:00:00.000Z",
        outputPacketHash: "left",
      },
      audit: {
        packetHash: "left",
      },
      value: "same",
    }
    const right = {
      instructionTuning: {
        generatedAt: "2026-05-11T00:00:00.000Z",
        outputPacketHash: "right",
      },
      audit: {
        packetHash: "right",
      },
      value: "same",
    }

    expect(trellisContentHash(left)).toBe(trellisContentHash(right))
  })
})
