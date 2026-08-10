/**
 * PLAYBOOK-KEEL-SCR-PORT-1: lifted from SCR (vcs.ts), byte-identical except
 * stripped `.ts` import extensions. `GitComposer`/real-git wiring is PORT-2
 * (`git.ts`, not ported here) -- `SimulatedComposer` is the no-git stand-in
 * Track 1 names.
 */
import type { Hunk } from './events';
import { sha } from './interdiff';

/**
 * On-disk representation of a revision's post-image.
 *
 * One line per section: `anchor<TAB>content`, sorted by anchor. Line-oriented
 * on purpose — it is what makes `git merge-file` produce a meaningful three-way
 * result. Content newlines are escaped.
 *
 * `PLACEHOLDER` marks an anchor that exists in the merge frame but is untouched
 * by a given side, so that a side which does touch it reads as a modification
 * rather than as an insertion into an empty file.
 */
export const PLACEHOLDER = '~';

export function escapeContent(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\t/g, '\\t');
}

export function unescapeContent(s: string): string {
  return s.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\\\/g, '\\');
}

export function renderFile(sections: Map<string, string>): string {
  return (
    [...sections.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([anchor, content]) => `${anchor}\t${escapeContent(content)}`)
      .join('\n') + '\n'
  );
}

export function parseFile(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const i = line.indexOf('\t');
    if (i === -1) continue;
    out.set(line.slice(0, i), unescapeContent(line.slice(i + 1)));
  }
  return out;
}

/** Group hunks by file path. */
export function byPath(hunks: Hunk[]): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  for (const h of hunks) {
    if (!out.has(h.path)) out.set(h.path, new Map());
    out.get(h.path)!.set(h.anchor, h.content);
  }
  return out;
}

export interface ComposeLayer {
  changeId: string;
  title: string;
  authorId: string;
  hunks: Hunk[];
  /** Content address of the revision, for the simulated composer. */
  revisionHash: string;
}

export interface ComposeResult {
  /** One SHA per layer, in order. OD-5. */
  shas: string[];
  newTargetSha: string;
}

/**
 * Port. The core never constructs a commit itself — INV-2 depends on the core
 * being unable to bind review state to whatever this returns.
 *
 * PLAYBOOK-KEEL-SCR-PORT-2, Track 2 finding (disclosed deviation from SCR's
 * own sync signature): `Promise<ComposeResult>`, not `ComposeResult`. SCR's
 * own composer never needed this -- `node:child_process`'s `execFileSync`
 * and `node:sqlite`'s `DatabaseSync` are both genuinely synchronous, so
 * `GitComposer.compose()` (real git, on SCR's own substrate) could stay
 * sync. KEEL's real git surface (`@cloudflare/shell`'s `createGit`, backed
 * by the Workspace's DO storage) has NO synchronous write path at all --
 * every `add`/`commit` call is a `Promise`. There is no way to write a real
 * git object against this substrate without awaiting I/O, so the port
 * cannot stay sync the way PORT-1's `EventLog`/`Keyring` did. The ripple is
 * fully contained: only `Composer.compose()` (and, in service.ts,
 * `ReviewService.land()`, the ONE method that calls it) is now async --
 * every other `ReviewService` method (openSeries, openChange, appendRevision,
 * recordVerdict, ...) is untouched, still fully synchronous.
 */
export interface Composer {
  compose(baseSha: string, layers: ComposeLayer[]): Promise<ComposeResult>;
}

/** Deterministic hash chain. Used by the unit suite; no repository required.
 *  `async` only to satisfy the (now Promise-returning) `Composer` port above
 *  -- the logic itself is unchanged and does no real I/O. */
export class SimulatedComposer implements Composer {
  async compose(baseSha: string, layers: ComposeLayer[]): Promise<ComposeResult> {
    let running = baseSha;
    const shas = layers.map((l) => {
      running = sha(`${running}\u0000${l.revisionHash}`);
      return running;
    });
    return { shas, newTargetSha: running };
  }
}
