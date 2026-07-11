/** Close-out: OD-6b-4 (KEEL-authored foreign docs) + decomposable opt-in. */
import { describe, it, expect } from "vitest";
import { foreignConnectorDoc, type ForeignToolConfig } from "../src/adapters/foreign/mcp-call";
import { templateDerive } from "../src/domain/index";
import type { SpecificationContent } from "../src/domain/lineage/nodes";

describe("OD-6b-4 KEEL-authored foreign connector doc", () => {
  it("builds the model-facing doc from KEEL config text only", () => {
    const tools: ForeignToolConfig[] = [
      { method: "getTier", description: "the customer's current plan tier", responseSchema: { fields: {} } },
    ];
    const doc = foreignConnectorDoc("foreign", tools);
    expect(doc.name).toBe("foreign");
    expect(doc.description).toContain("foreign.getTier(...) => the customer's current plan tier");
    // the text is exactly KEEL's config — there is no server tools/list input to this function
  });
});

describe("decomposition opt-in (OD-6a-6-adjacent)", () => {
  const base: SpecificationContent = {
    intent: "goal", capabilityCeiling: "connectors-only",
    acceptance: [{ id: "A1", statement: "x", kind: "example" }, { id: "A2", statement: "y", kind: "property" }],
    connectors: ["echo"], approvalGated: [], attemptBudget: 2, oracleRef: "multi@v1",
  };
  it("NOT decomposable by default -> no split (coupled criteria stay together)", () => {
    expect(templateDerive(base, base)).toHaveLength(0);
  });
  it("decomposable:true (declared independent) -> per-criterion sub-specs", () => {
    expect(templateDerive({ ...base, decomposable: true }, base)).toHaveLength(2);
  });
});
