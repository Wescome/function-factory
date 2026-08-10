/**
 * PLAYBOOK-KEEL-SCR-PORT-2, Track 1: `IsomorphicGitRebaser` against the
 * exact same scenarios the PORT-1 spike ran through the private internal --
 * now through the public `diff3` door. Mirrors SCR's own git.test.ts
 * "git merge-file decides conflicts" scenarios directly on the rebaser
 * (no ReviewService needed for this -- it's a pure Rebaser unit).
 */
import { describe, it, expect } from "vitest";
import { IsomorphicGitRebaser } from "../src/adapters/git/isomorphic-git-rebaser.adapter";
import type { Hunk } from "../src/scr/events";

const h = (path: string, anchor: string, content: string): Hunk => ({ path, anchor, content });
const rebaser = new IsomorphicGitRebaser();

describe("IsomorphicGitRebaser — the public-door merge matches the spike's private-internal result", () => {
  it("same file, different anchors — clean replay", () => {
    const res = rebaser.rebase([h("shared.ts", "body", "use x")], [h("shared.ts", "imports", "import x")]);
    expect(res.ok).toBe(true);
  });

  it("same file, same anchor, different content — CONFLICTED, hunk preserved", () => {
    const changeHunk = h("shared.ts", "body", "from-B");
    const res = rebaser.rebase([changeHunk], [h("shared.ts", "body", "from-A")]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.hunk).toEqual(changeHunk);
  });

  it("same file, same anchor, identical content — no conflict", () => {
    const res = rebaser.rebase(
      [h("shared.ts", "body", "same"), h("shared.ts", "x", "extra")],
      [h("shared.ts", "body", "same")],
    );
    expect(res.ok).toBe(true);
  });

  it("untouched file — nothing to merge, clean", () => {
    const res = rebaser.rebase([h("a.ts", "top", "A")], [h("b.ts", "top", "B")]);
    expect(res.ok).toBe(true);
  });

  it("padding stress: five disjoint anchors on the same file — no cross-anchor false conflict", () => {
    const res = rebaser.rebase(
      [h("f.ts", "a1", "A"), h("f.ts", "a3", "C"), h("f.ts", "a5", "E")],
      [h("f.ts", "a2", "B"), h("f.ts", "a4", "D")],
    );
    expect(res.ok).toBe(true);
  });

  it("content with embedded newlines/tabs round-trips through the frame correctly", () => {
    const res = rebaser.rebase(
      [h("f.ts", "multiline", "line one\nline two\twith tab")],
      [h("f.ts", "other", "x")],
    );
    expect(res.ok).toBe(true);
  });
});
