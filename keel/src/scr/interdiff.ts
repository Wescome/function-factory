/**
 * PLAYBOOK-KEEL-SCR-PORT-1: lifted from SCR (interdiff.ts), byte-identical
 * except stripped `.ts` import extensions. `/// <reference types="node" />`
 * is file-scoped opt-in (KEEL's tsconfig deliberately does NOT list "node"
 * in its global `types` array, to avoid an ambient clash with
 * @cloudflare/workers-types elsewhere in the project) -- needed only because
 * `node:crypto` (Track 3's confirmed, unmodified seal substrate) requires it.
 */
/// <reference types="node" />
import { createHash } from 'node:crypto';
import type { Hunk } from './events';

export function sha(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 32);
}

/** Content address of a single hunk. */
export function hunkId(h: Hunk): string {
  return sha(`${h.path}\u0000${h.anchor}\u0000${h.content}`);
}

/** Content address of a revision's full post-image. Order-insensitive. */
export function revisionHash(hunks: Hunk[]): string {
  return sha(hunks.map(hunkId).sort().join('\n'));
}

/**
 * A declared, replayable transformation. INV-3' generalises carry-forward from
 * "the interdiff is empty" to "the interdiff is empty *modulo a transform the
 * author declared*" — which is what stops a rename or a reindent from lapsing
 * every approval in the stack for no semantic reason.
 *
 * The list is deliberately closed. "Small enough" is not a transform, because
 * nothing can say how small; a transform must be nameable and replayable, or
 * the verdict lapses.
 */
export type Transform =
  | { kind: 'rename'; from: string; to: string }
  | { kind: 'whitespace' }
  | { kind: 'reindent' };

/** Rewrite the pre-image so it speaks in the post-image's terms. */
export function applyTransforms(hunks: Hunk[], transforms: Transform[]): Hunk[] {
  let out = hunks;
  for (const t of transforms) {
    if (t.kind !== 'rename') continue;
    out = out.map((h) => (h.path === t.from ? { ...h, path: t.to } : h));
  }
  return out;
}

/** Rename-aware scope migration: a verdict follows the file it approved. */
export function transformScope(scope: string[], transforms: Transform[]): string[] {
  let out = scope;
  for (const t of transforms) {
    if (t.kind !== 'rename') continue;
    out = out.map((p) => (p === t.from ? t.to : p));
  }
  return out;
}

/** Content normalisation, applied to both sides so the comparison is fair. */
export function normalizeContent(content: string, transforms: Transform[]): string {
  let out = content;
  for (const t of transforms) {
    if (t.kind === 'whitespace') out = out.replace(/[ \t]+/g, ' ').trim();
    if (t.kind === 'reindent') out = out.replace(/^[ \t]+/gm, '');
  }
  return out;
}

function normalizeHunks(hunks: Hunk[], transforms: Transform[]): Hunk[] {
  if (!transforms.length) return hunks;
  return applyTransforms(hunks, transforms).map((h) => ({
    ...h,
    content: normalizeContent(h.content, transforms),
  }));
}

export interface Interdiff {
  /** Hunks present in `to` but not `from`. */
  added: Hunk[];
  /** Hunks present in `from` but not `to`. */
  removed: Hunk[];
  hash: string;
  empty: boolean;
}

/**
 * OD-2 (lean: hunk-level). Two revisions differ where their hunk content
 * addresses differ. A pure rebase that reproduces identical hunks yields an
 * empty interdiff; any edit to a hunk's content or anchor does not.
 *
 * `scope` restricts comparison to a set of file paths. Empty scope = whole
 * change.
 */
export function interdiff(
  from: Hunk[],
  to: Hunk[],
  scope: string[] = [],
  transforms: Transform[] = [],
): Interdiff {
  // Both sides are normalised, and the scope is migrated, so that a declared
  // transform cancels out instead of registering as change.
  const scoped = transformScope(scope, transforms);
  const inScope = (h: Hunk) => scoped.length === 0 || scoped.includes(h.path);
  const f = normalizeHunks(from, transforms).filter(inScope);
  const t = normalizeHunks(to, transforms).filter(inScope);

  const fIds = new Map(f.map((h) => [hunkId(h), h]));
  const tIds = new Map(t.map((h) => [hunkId(h), h]));

  const added = [...tIds].filter(([id]) => !fIds.has(id)).map(([, h]) => h);
  const removed = [...fIds].filter(([id]) => !tIds.has(id)).map(([, h]) => h);

  const hash = sha(
    JSON.stringify({
      scope: [...scoped].sort(),
      transforms,
      added: added.map(hunkId).sort(),
      removed: removed.map(hunkId).sort(),
    }),
  );

  return { added, removed, hash, empty: added.length === 0 && removed.length === 0 };
}

/**
 * INV-3 CARRY-FORWARD-IS-EXPLICIT.
 *
 * Returns the interdiff that justifies carry-forward, or null when the verdict
 * must lapse to STALE. Never returns "probably fine".
 */
export function carryForwardEligible(
  fromHunks: Hunk[],
  toHunks: Hunk[],
  scope: string[],
  transforms: Transform[] = [],
): { interdiff: Interdiff; scope: string[] } | null {
  const d = interdiff(fromHunks, toHunks, scope, transforms);
  return d.empty ? { interdiff: d, scope: transformScope(scope, transforms) } : null;
}

/**
 * INV-4 TWO-AXIS-CHECK, axis 2.
 *
 * The base of change k is the target SHA plus the exact content of every
 * change below it. Landing or editing any lower layer changes this value, so
 * integrated checks above it go stale by construction rather than by
 * heuristic.
 */
export function baseFingerprint(
  targetSha: string,
  lowerLayers: { changeId: string; revisionSeq: number; revisionHash: string }[],
): string {
  return sha(
    JSON.stringify([
      targetSha,
      ...lowerLayers.map((l) => `${l.changeId}@${l.revisionSeq}:${l.revisionHash}`),
    ]),
  );
}
