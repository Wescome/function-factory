/**
 * PLAYBOOK-KEEL-TRIAGE-001 (D2) — routeTriage: the cause picks the exit
 * (B.2), gated by evidence (B.3/B.4, never-worse). Exhaustive over the
 * disposed five-value cause set, mirroring test/verdict-aggregate.test.ts's
 * style for a new pure domain function.
 */
import { describe, it, expect } from "vitest";
import { routeTriage, type TriageProposal, type TriageEvidence, type TriageCause } from "../src/domain/index";

const propose = (cause: TriageCause): TriageProposal => ({ cause });
const noEvidence: TriageEvidence = {};

describe("routeTriage — B.4 never-worse / B.3 evidence gate", () => {
  it("implementation-defect -> amend, the status-quo default, no evidence needed", () => {
    expect(routeTriage(propose("implementation-defect"), noEvidence)).toEqual({ exit: "amend" });
  });

  it("D.2 / unknown -> amend, the fail-closed default, identical to implementation-defect", () => {
    expect(routeTriage(propose("unknown"), noEvidence)).toEqual({ exit: "amend" });
  });

  it("D.4 / requirement-ambiguity -> escalate, fail-closed, ambiguity IS the evidence (no gate)", () => {
    expect(routeTriage(propose("requirement-ambiguity"), noEvidence)).toEqual({ exit: "escalate", reason: "requirement-ambiguity" });
  });

  it("D.5 / invalid-applicability WITHOUT criterionScopable evidence -> amend (never diverts on the label alone)", () => {
    expect(routeTriage(propose("invalid-applicability"), noEvidence)).toEqual({ exit: "amend" });
  });
  it("invalid-applicability WITH criterionScopable evidence -> escalate invalid-applicability (surface-to-narrow, R1)", () => {
    expect(routeTriage(propose("invalid-applicability"), { criterionScopable: true })).toEqual({ exit: "escalate", reason: "invalid-applicability" });
  });

  it("D.5 / D.3 / incorrect-relation WITHOUT humanConfirmed evidence -> amend (never surfaced on the label alone)", () => {
    expect(routeTriage(propose("incorrect-relation"), noEvidence)).toEqual({ exit: "amend" });
  });
  it("D.3 / incorrect-relation WITH humanConfirmed evidence -> escalate incorrect-relation (surface, never regenerate, never rewrite the test)", () => {
    expect(routeTriage(propose("incorrect-relation"), { humanConfirmed: true })).toEqual({ exit: "escalate", reason: "incorrect-relation" });
  });

  it("D.5: full evidence does not help a status-quo cause -- amend regardless (evidence gates divergence, it doesn't invent a divergence)", () => {
    const allEvidence: TriageEvidence = { criterionScopable: true, humanConfirmed: true };
    expect(routeTriage(propose("implementation-defect"), allEvidence)).toEqual({ exit: "amend" });
    expect(routeTriage(propose("unknown"), allEvidence)).toEqual({ exit: "amend" });
  });
});
