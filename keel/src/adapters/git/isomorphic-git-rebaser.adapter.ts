/**
 * PLAYBOOK-KEEL-SCR-PORT-2, Track 1: `GitMergeFileRebaser` re-expressed
 * against isomorphic-git's PUBLIC surface.
 *
 * The section frame below (SPACER filler + PLACEHOLDER sentinel,
 * `byPath`/`escapeContent` from `src/scr/vcs.ts`) is SCR's own logic,
 * copied verbatim from `git.ts` -- it is what turns a raw three-way file
 * merge into a clean per-anchor boolean, never a synthesized merge. It is
 * not touched here; only the merge call underneath it changes.
 *
 * OD-PORT-2 (disposed): the PORT-1 spike proved isomorphic-git's diff3
 * matches real `git merge-file` on every one of these frame scenarios --
 * but through isomorphic-git's UNEXPORTED internal `mergeFile()`. That
 * internal is not part of isomorphic-git's supported API and could change
 * or vanish across a version bump with no notice. `@cloudflare/shell`'s
 * `createGit()` (KEEL's actual git surface) doesn't expose `merge()` or a
 * `mergeDriver` option AT ALL (confirmed by reading its own `.d.ts` --
 * `clone/status/add/rm/commit/log/branch/checkout/fetch/pull/push/diff/
 * init/remote`, no `merge`), so reaching the algorithm through a real
 * `git.merge({mergeDriver})` call would mean bypassing `@cloudflare/shell`
 * to import `isomorphic-git` directly AND spinning up a real two-commit
 * repo for every single per-file merge SCR's rebaser runs -- exactly the
 * "awkward" case the playbook names. The `diff3` npm package -- a real,
 * independently versioned, MIT-licensed dependency isomorphic-git's own
 * internal wraps -- is the clean public door instead: same algorithm, a
 * real supported surface, no synthetic repo required per merge.
 */
import { byPath, escapeContent, PLACEHOLDER } from "../../scr/vcs";
import type { Hunk } from "../../scr/events";
import type { RebaseResult, Rebaser } from "../../scr/rebase";
import diff3Merge from "diff3";

/** SCR's own frame padding (git.ts) -- copied verbatim, unchanged. */
const SPACER = ".\n.\n.\n.\n";

const LINEBREAKS = /^.*(\r?\n|$)/gm;

/**
 * The SAME algorithm isomorphic-git's own (unexported) `mergeFile()`
 * wraps, reimplemented against `diff3`'s public API -- matches the
 * documented `MergeDriverCallback` contract's shape (three contents in,
 * `{cleanMerge, mergedText}` out) from isomorphic-git's own public
 * `index.d.ts`, even though nothing here calls through `git.merge()`
 * itself (see this file's own header for why that path is awkward for a
 * per-file merge). `cleanMerge` is the SAME signal SCR read from
 * `git merge-file`'s exit status.
 */
function mergeFrames(oursText: string, baseText: string, theirsText: string): { cleanMerge: boolean; mergedText: string } {
  const ours = oursText.match(LINEBREAKS) ?? [];
  const base = baseText.match(LINEBREAKS) ?? [];
  const theirs = theirsText.match(LINEBREAKS) ?? [];
  const chunks = diff3Merge(ours, base, theirs);

  let mergedText = "";
  let cleanMerge = true;
  for (const chunk of chunks) {
    if ("ok" in chunk) {
      mergedText += chunk.ok.join("");
    } else {
      cleanMerge = false;
      mergedText += `<<<<<<< ours\n${chunk.conflict.a.join("")}=======\n${chunk.conflict.b.join("")}>>>>>>> theirs\n`;
    }
  }
  return { cleanMerge, mergedText };
}

/**
 * Real three-way merge, no subprocess, no scratch filesystem -- the frame
 * strings go straight into `mergeFrames` in memory (SCR's own version wrote
 * them to a scratch dir only because `execFileSync('git', ...)` needs real
 * files; that plumbing is gone, not replaced, since it served no purpose
 * beyond reaching the subprocess). `dispose()` is gone with it -- nothing
 * left to clean up.
 */
export class IsomorphicGitRebaser implements Rebaser {
  rebase(changeHunks: Hunk[], landedHunks: Hunk[]): RebaseResult {
    const ours = byPath(changeHunks);
    const theirs = byPath(landedHunks);

    for (const [path, ourSections] of ours) {
      const theirSections = theirs.get(path);
      if (!theirSections) continue; // untouched file — nothing to merge

      const anchors = [...new Set([...ourSections.keys(), ...theirSections.keys()])].sort();
      const frame = (side: Map<string, string> | null) =>
        anchors
          .map((a) => `${SPACER}${a}\t${escapeContent(side?.get(a) ?? PLACEHOLDER)}`)
          .join("\n") + "\n";

      const { cleanMerge } = mergeFrames(frame(ourSections), frame(null), frame(theirSections));
      if (!cleanMerge) {
        // Report the first anchor both sides moved differently.
        const anchor = [...anchors].sort().find(
          (a) =>
            ourSections.has(a) &&
            theirSections.has(a) &&
            ourSections.get(a) !== theirSections.get(a),
        );
        const hunk =
          changeHunks.find((h) => h.path === path && h.anchor === anchor) ??
          changeHunks.find((h) => h.path === path)!;
        return { ok: false, hunk };
      }
    }

    return { ok: true, hunks: changeHunks };
  }
}
