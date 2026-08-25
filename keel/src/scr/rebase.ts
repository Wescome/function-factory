/**
 * PLAYBOOK-KEEL-SCR-PORT-1: lifted from SCR (rebase.ts), byte-identical
 * except stripped `.ts` import extensions. `GitMergeFileRebaser` (real git)
 * is PORT-2 (`git.ts`, not ported here) -- `AnchorRebaser` is the no-git
 * stand-in Track 1 names.
 */
import type { Hunk } from './events';

export type RebaseResult =
  | { ok: true; hunks: Hunk[] }
  | { ok: false; hunk: Hunk };

/**
 * Port. A real deployment substitutes git. The core never assumes rebase
 * succeeds — INV-9 requires failure to be a recordable state, not an error.
 */
export interface Rebaser {
  rebase(changeHunks: Hunk[], landedHunks: Hunk[]): RebaseResult;
}

/**
 * Reference simulator: a hunk conflicts when a landed hunk occupies the same
 * (path, anchor) with different content. Otherwise the change replays
 * unmodified, so the interdiff against the prior revision is empty and the
 * verdict carries forward (INV-3).
 */
export class AnchorRebaser implements Rebaser {
  rebase(changeHunks: Hunk[], landedHunks: Hunk[]): RebaseResult {
    for (const h of changeHunks) {
      const clash = landedHunks.find(
        (l) => l.path === h.path && l.anchor === h.anchor && l.content !== h.content,
      );
      if (clash) return { ok: false, hunk: h };
    }
    return { ok: true, hunks: changeHunks };
  }
}
