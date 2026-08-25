/**
 * PLAYBOOK-KEEL-SLICE-FILES-001 (C1b, Track 3): `checkFileOverlap` is the
 * same whole-batch, pure shape as `checkCoverage`/`checkDependencyGraph` —
 * a set check over already-discovered data (Track 2's per-child written-file
 * sets), never itself touching a Workspace.
 */
import { describe, it, expect } from "vitest";
import { checkFileOverlap } from "../src/domain/index";

describe("checkFileOverlap — pure", () => {
  it("no files written by anyone -> ok, no overlaps", () => {
    expect(checkFileOverlap([{ id: "A", writtenFiles: [] }, { id: "B", writtenFiles: [] }]))
      .toEqual({ ok: true, overlaps: [] });
  });

  it("disjoint file sets -> ok, no overlaps", () => {
    const report = checkFileOverlap([
      { id: "A", writtenFiles: ["a.ts"] },
      { id: "B", writtenFiles: ["b.ts"] },
    ]);
    expect(report).toEqual({ ok: true, overlaps: [] });
  });

  it("two children touching the SAME file -> an overlap naming both", () => {
    const report = checkFileOverlap([
      { id: "A", writtenFiles: ["shared.ts"] },
      { id: "B", writtenFiles: ["shared.ts"] },
    ]);
    expect(report.ok).toBe(false);
    expect(report.overlaps).toEqual([{ file: "shared.ts", children: ["A", "B"] }]);
  });

  it("a single child touching a file twice (idempotent) is not an overlap", () => {
    const report = checkFileOverlap([{ id: "A", writtenFiles: ["a.ts", "a.ts"] }]);
    expect(report).toEqual({ ok: true, overlaps: [] });
  });

  it("three children, one shared file among two, a third disjoint -> only the real overlap is reported", () => {
    const report = checkFileOverlap([
      { id: "A", writtenFiles: ["shared.ts", "a-only.ts"] },
      { id: "B", writtenFiles: ["shared.ts"] },
      { id: "C", writtenFiles: ["c-only.ts"] },
    ]);
    expect(report.ok).toBe(false);
    expect(report.overlaps).toEqual([{ file: "shared.ts", children: ["A", "B"] }]);
  });

  it("multiple distinct overlapping files -> sorted by file path", () => {
    const report = checkFileOverlap([
      { id: "A", writtenFiles: ["z.ts", "a.ts"] },
      { id: "B", writtenFiles: ["z.ts", "a.ts"] },
    ]);
    expect(report.overlaps.map((o) => o.file)).toEqual(["a.ts", "z.ts"]);
  });
});
