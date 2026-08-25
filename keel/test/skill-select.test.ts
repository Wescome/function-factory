/** BRIEF-KEEL-SKILL-001: selectSkills is pure — rows in, selection out. */
import { describe, it, expect } from "vitest";
import { selectSkills, type SkillRecord } from "../src/domain/index";

const doc = (over: Partial<SkillRecord> = {}): SkillRecord => ({
  id: "s1", kind: "connector-doc", key: "weather", content: "weather.current(...) shape line",
  version: 1, status: "active", evidence: { n: 20, baseAccepts: 0, imprAccepts: 20 }, ...over,
});
const procedure = (over: Partial<SkillRecord> = {}): SkillRecord => ({
  id: "p1", kind: "procedure", key: "fx.snapshot", content: "return await fx.rate(...)",
  version: 1, status: "active", evidence: { attemptsBefore: 3, attemptsAfter: 1 }, ...over,
});
const nudge = (over: Partial<SkillRecord> = {}): SkillRecord => ({
  id: "n1", kind: "amend-prompt", key: "weather.forCity", content: "re-read the nested response shape",
  version: 1, status: "active", evidence: {}, ...over,
});

describe("selectSkills — empty store is legal and non-breaking", () => {
  it("no rows -> empty selection", () => {
    const r = selectSkills([], ["weather"], "weather.forCity");
    expect(r).toEqual({ connectorDocs: [], procedure: undefined, amendNudge: undefined, ids: [] });
  });
});

describe("selectSkills — connector-doc (keyed by connector name, present in spec.connectors)", () => {
  it("selects an active doc for a connector the spec actually uses", () => {
    const r = selectSkills([doc()], ["weather", "geo"], "weather.forCity");
    expect(r.connectorDocs).toEqual([{ name: "weather", description: "weather.current(...) shape line" }]);
    expect(r.ids).toEqual(["s1@1"]);
  });
  it("does NOT select a doc for a connector the spec doesn't use", () => {
    const r = selectSkills([doc()], ["fx"], "fx.snapshot");
    expect(r.connectorDocs).toEqual([]);
  });
  it("a RETIRED doc is never selected", () => {
    const r = selectSkills([doc({ status: "retired" })], ["weather"], "weather.forCity");
    expect(r.connectorDocs).toEqual([]);
  });
  it("n caps how many candidates are considered", () => {
    const rows = [doc({ id: "a" }), doc({ id: "b", key: "geo" })];
    const r = selectSkills(rows, ["weather", "geo"], "weather.forCity", { n: 1 });
    expect(r.connectorDocs).toHaveLength(1);
  });
});

describe("selectSkills — procedure (keyed by intent)", () => {
  it("selects an active procedure matching the intent", () => {
    const r = selectSkills([procedure()], ["fx"], "fx.snapshot");
    expect(r.procedure).toBe("return await fx.rate(...)");
    expect(r.ids).toContain("p1@1");
  });
  it("no procedure for a non-matching intent", () => {
    const r = selectSkills([procedure()], ["fx"], "something-else");
    expect(r.procedure).toBeUndefined();
  });
  it("OD-SKILL-1: a TERMINAL divergence class suppresses procedure selection", () => {
    const r = selectSkills([procedure()], ["fx"], "fx.snapshot", { amend: true, divergenceClass: "PermissionDenied" });
    expect(r.procedure).toBeUndefined();
  });
  it("an AMENDABLE divergence class does NOT suppress procedure selection", () => {
    const r = selectSkills([procedure()], ["fx"], "fx.snapshot", { amend: true, divergenceClass: "Conflict" });
    expect(r.procedure).toBe("return await fx.rate(...)");
  });
});

describe("selectSkills — amend-prompt (OD-SKILL-4: trigger-on-stall)", () => {
  it("cold start (amend not set) never selects an amend nudge", () => {
    const r = selectSkills([nudge()], ["weather"], "weather.forCity");
    expect(r.amendNudge).toBeUndefined();
  });
  it("an amend call selects the matching active nudge", () => {
    const r = selectSkills([nudge()], ["weather"], "weather.forCity", { amend: true });
    expect(r.amendNudge).toBe("re-read the nested response shape");
    expect(r.ids).toContain("n1@1");
  });
});

describe("selectSkills — all three surfaces compose in one call", () => {
  it("returns docs + procedure + amendNudge together, ids collect all", () => {
    const r = selectSkills([doc(), procedure({ key: "weather.forCity" }), nudge()], ["weather"], "weather.forCity", { amend: true });
    expect(r.connectorDocs).toHaveLength(1);
    expect(r.procedure).toBeDefined();
    expect(r.amendNudge).toBeDefined();
    expect([...r.ids].sort()).toEqual(["n1@1", "p1@1", "s1@1"]);
  });
});
