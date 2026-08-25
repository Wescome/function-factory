/**
 * PLAYBOOK-KEEL-DISPOSITION-001 — the pure core: resolveDisposition (OD-DISP-2
 * fail-closed), authorityMatches (B.3),
 * overlayDisposition (B.2/B.3, the decision applied after grounding grading).
 * `familyMismatch` (OD-DISP-4's warning) is RETIRED -- PLAYBOOK-KEEL-FAMILY-001
 * (R4) replaced it with a `freezeGate` reject; see
 * test/family-gate.test.ts's `familyAdmissibleForDisposition`.
 */
import { describe, it, expect } from "vitest";
import {
  resolveDisposition, authorityMatches, overlayDisposition,
  type BehaviorLedgerEntry,
} from "../src/domain/index";

const entry = (o: Partial<BehaviorLedgerEntry>): BehaviorLedgerEntry => ({
  behaviorRef: "refund-flow", behaviorDisposition: "preserve", authority: "root-1", rationale: "r", assignedBy: "owner", ...o,
});

describe("resolveDisposition — OD-DISP-2, fail-closed", () => {
  it("no entry at all -> unknown", () => {
    expect(resolveDisposition(null)).toBe("unknown");
    expect(resolveDisposition(undefined)).toBe("unknown");
  });
  it("an owner-assigned entry -> its disposition", () => {
    expect(resolveDisposition(entry({ behaviorDisposition: "improve" }))).toBe("improve");
  });
  it("a model-proposed (never owner-signed) entry -> unknown, identically to no entry -- a model may propose but never assign unattended", () => {
    expect(resolveDisposition(entry({ behaviorDisposition: "preserve", assignedBy: "model-proposed" }))).toBe("unknown");
  });
});

describe("authorityMatches — B.3, routes intentionally-change to the root authority", () => {
  it("a root spec (no derivedFrom) trivially owns its own behaviors", () => {
    expect(authorityMatches(undefined, "any-authority-at-all")).toBe(true);
  });
  it("a derived spec whose root matches the entry's recorded authority -> true", () => {
    expect(authorityMatches("root-1", "root-1")).toBe(true);
  });
  it("a derived spec whose root does NOT match -> false (grounding the relation is not enough)", () => {
    expect(authorityMatches("root-2", "root-1")).toBe(false);
  });
});

describe("overlayDisposition — INV-DISP-UNKNOWN-BLOCKS / INV-DISP-DRIVES-AUTHORITY", () => {
  it("unknown forces escalate regardless of how confidently the base grading concluded", () => {
    expect(overlayDisposition("grounded", "unknown", true)).toBe("escalate");
    expect(overlayDisposition("contradicted", "unknown", true)).toBe("escalate");
  });
  it("intentionally-change with authority mismatch forces escalate even if grounded", () => {
    expect(overlayDisposition("grounded", "intentionally-change", false)).toBe("escalate");
  });
  it("intentionally-change with matching authority leaves the base outcome alone", () => {
    expect(overlayDisposition("grounded", "intentionally-change", true)).toBe("grounded");
    expect(overlayDisposition("contradicted", "intentionally-change", true)).toBe("contradicted");
  });
  it("preserve/improve/deprecate never override the base grading", () => {
    expect(overlayDisposition("grounded", "preserve", true)).toBe("grounded");
    expect(overlayDisposition("contradicted", "improve", false)).toBe("contradicted");
    expect(overlayDisposition("escalate", "deprecate", true)).toBe("escalate");
  });
});
