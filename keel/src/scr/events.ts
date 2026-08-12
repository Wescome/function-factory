/**
 * PLAYBOOK-KEEL-SCR-PORT-1: lifted from SCR (`/Users/wes/workspace/SCR/src-
 * extracted/scr/src/events.ts`), byte-identical except import specifiers
 * (`.ts` extensions stripped to match KEEL's own house style — this repo's
 * moduleResolution is "bundler", which doesn't require them, and no other
 * KEEL source file uses them). No invariant logic touched (Track 1: "do not
 * rewrite invariant logic").
 *
 * Stacked Change Review — event vocabulary.
 *
 * INV-8 APPEND-ONLY-REVIEW-LOG: every fact in this file is appended, never
 * mutated. All projected state in model.ts is a fold over this sequence.
 */

/** A unit of textual change. Identity is content-addressed. */
export interface Hunk {
  /** File path this hunk applies to. */
  path: string;
  /** Anchor within the file. Opaque to the core; the rebaser interprets it. */
  anchor: string;
  /** Post-image content of the hunk. */
  content: string;
}

export type Decision = 'approve' | 'reject';

// PLAYBOOK-KEEL-SCR-PORT-1: SCR's original `export type { Transform } from
// './interdiff.ts';` re-exports WITHOUT binding `Transform` in this file's
// own local scope -- SCR's own test suite never caught this because it runs
// via `node --experimental-strip-types`, which erases types syntactically
// and never actually type-checks. KEEL's real `tsc --noEmit` gate does.
// Split into an explicit local import (for the `Transform[]` usages below)
// plus a separate re-export, so both this file and every importer of
// `events.ts` see the identical public surface SCR intended. Zero runtime
// change -- types are erased either way.
import type { Transform } from './interdiff';
export type { Transform };

/** Why a verdict lapsed. INV-3: staleness always names its cause. */
export type StaleCause =
  | 'new-revision'
  | 'base-changed'
  | 'reordered'
  | 'target-advanced';

export type CheckKind =
  /** Does this Change's own suite pass, in isolation? */
  | 'isolated'
  /** Does the composed prefix through this Change pass? */
  | 'integrated';

export type CheckOutcome = 'pass' | 'fail';

export interface EventBase {
  eventId: string;
  at: number;
  actorId: string;
  /** Digest of the preceding event. Added by the seal (INV-12). */
  prev: string;
  /** Digest of this event, chained to `prev`. Added by the seal. */
  digest: string;
  /** Ed25519 signature over `digest` by `actorId`. Added by the seal. */
  sig: string;
}

/** What a command produces, before the service seals and appends it. */
// PLAYBOOK-KEEL-SCR-PORT-1: a second SCR type-only bug KEEL's real `tsc
// --noEmit` catches (see the Transform note above -- same root cause, SCR's
// own suite never type-checks). A bare `Omit<T, K>` does NOT distribute over
// a union: `Omit<A | B, K>` computes `Pick<A | B, Exclude<keyof (A | B), K>>`,
// and `keyof (A | B)` is only the KEYS COMMON TO EVERY MEMBER -- so
// `Unsealed<ReviewEvent>` silently collapsed to just the shared EventBase
// fields, losing every event's own discriminating fields (`seriesId`,
// `changeId`, `verdictId`, ...). `T extends any ? ... : never` is the
// standard distributive-conditional idiom that fixes it: TypeScript applies
// the Omit to EACH union member separately, then re-unions the results.
// Zero runtime change -- purely a type-level correctness fix.
export type Unsealed<T> = T extends unknown ? Omit<T, 'prev' | 'digest' | 'sig'> : never;
export type UnsealedEvent = Unsealed<ReviewEvent>;

export interface SeriesOpened extends EventBase {
  type: 'SeriesOpened';
  seriesId: string;
  targetRef: string;
  targetSha: string;
}

export interface ChangeOpened extends EventBase {
  type: 'ChangeOpened';
  seriesId: string;
  changeId: string;
  title: string;
  /** INV-10: authorship is recorded here and never moved by reparenting. */
  authorId: string;
  /**
   * Changes this one builds on. Empty means it sits directly on the target.
   * A linear stack is the special case where every change has exactly one
   * parent; a diamond is two changes naming the same parent and a third naming
   * both of them.
   */
  parents: string[];
  /** OD-4 (per-Change): reviewers whose non-stale approval is required to land. */
  requiredReviewers: string[];
  /** Set only for changes produced by a split. Provenance edge (OD-3). */
  splitFrom?: string;
}

export interface RevisionAppended extends EventBase {
  type: 'RevisionAppended';
  changeId: string;
  seq: number;
  hunks: Hunk[];
  /**
   * 'author-edit' | 'rebase' | 'split' | 'conflict-resolution'.
   *
   * INV-14: 'conflict-resolution' is content no reviewer has seen, whatever its
   * size, so no verdict ever carries across it.
   */
  reason: string;
  /** INV-3': declared transformations this revision applied. */
  transforms?: Transform[];
}

export interface VerdictRecorded extends EventBase {
  type: 'VerdictRecorded';
  verdictId: string;
  changeId: string;
  /** INV-2: bound to a Revision, never to a SHA. */
  revisionSeq: number;
  reviewerId: string;
  decision: Decision;
  /**
   * OD-2: file paths this verdict covers. Empty array means whole-change.
   * Carry-forward compares hunks inside this scope only.
   */
  scope: string[];
}

export interface VerdictStaled extends EventBase {
  type: 'VerdictStaled';
  verdictId: string;
  cause: StaleCause;
}

export interface VerdictCarriedForward extends EventBase {
  type: 'VerdictCarriedForward';
  fromVerdictId: string;
  verdictId: string;
  changeId: string;
  toRevisionSeq: number;
  /** INV-3: the carry-forward records the interdiff it was justified by. */
  interdiffHash: string;
  /** Scope after transform migration — a verdict follows the file it approved. */
  scope?: string[];
  /** INV-3': which declared transforms justified carrying across a rewrite. */
  transforms?: Transform[];
}

export interface CheckRecorded extends EventBase {
  type: 'CheckRecorded';
  checkId: string;
  changeId: string;
  /** INV-4: two-axis key, part 1. */
  revisionSeq: number;
  /** INV-4: two-axis key, part 2. */
  baseFingerprint: string;
  kind: CheckKind;
  outcome: CheckOutcome;
}

/**
 * INV-7 NO-SILENT-REPARENT. Moving a change in the graph is an operation, never
 * a side effect. `SeriesReordered` is the linear special case, kept because
 * `scr reorder a b c` is what people actually type.
 */
export interface ChangeReparented extends EventBase {
  type: 'ChangeReparented';
  changeId: string;
  parents: string[];
}

export interface SeriesReordered extends EventBase {
  type: 'SeriesReordered';
  seriesId: string;
  /** INV-7: the full new order, explicitly. */
  order: string[];
}

export interface ChangeConflicted extends EventBase {
  type: 'ChangeConflicted';
  changeId: string;
  /** INV-9: the failing hunk is recorded, not discarded. */
  hunk: Hunk;
  againstBaseFingerprint: string;
}

export interface ChangeAbandoned extends EventBase {
  type: 'ChangeAbandoned';
  changeId: string;
  reason: string;
}

/**
 * The target ref moved underneath the series — someone else landed, a hotfix
 * shipped, a merge queue drained. INV-11: this is a fact the series records,
 * not a condition it discovers by crashing into it.
 *
 * `incomingHunks` is what arrived from upstream, so the open layers can be
 * replayed onto it exactly as they are after a partial land.
 */
export interface TargetAdvanced extends EventBase {
  type: 'TargetAdvanced';
  seriesId: string;
  fromSha: string;
  toSha: string;
  incomingHunks: Hunk[];
}

/**
 * PLAYBOOK-KEEL-SCR-PORT-3_5: SCR's own `PARTIALLY-PROPAGATED`, designed but
 * never built (DECISIONS) -- built here. The join between mutable code
 * history and immutable review history splits in two: this event is the
 * ATOMIC domain decision (always true, even mid-propagation); `Pushed` and
 * `PrOpened` (below) are propagation confirmations, each written only after
 * its real external step actually confirms. The log never asserts a status
 * ahead of the fact -- `LandAuthorised` alone means "authorised, not
 * necessarily externally propagated yet" for a two-tier land; for a
 * local-only land (no external repo) it is the complete, terminal fact.
 */
export interface LandAuthorised extends EventBase {
  type: 'LandAuthorised';
  landEventId: string;
  seriesId: string;
  /**
   * A downward-closed set, in the topological order it was composed. INV-5.
   * For a linear series this is a contiguous prefix.
   */
  changeIds: string[];
  /** OD-5: one commit per Change, 1:1 with changeIds. */
  landedShas: string[];
  /** Revision of each change that actually landed. */
  revisionSeqs: number[];
  /** Verdicts that authorised the land, per change. */
  verdictIds: string[][];
  /** Base the prefix was composed against. */
  baseFingerprint: string;
  baseSha: string;
  /** The compose step's own result -- the tip of whatever ref it moved. */
  newTargetSha: string;
  /**
   * PLAYBOOK-KEEL-SCR-PORT-3_5, Track 2 (the false-drift fix): did compose
   * move the REAL thing INV-11 fences against, or a side ref (a two-tier
   * land's feature branch, not yet merged)? Reported by the `Composer` port
   * itself (it alone knows what `ref` it built onto) and consulted by
   * `Model.apply` to decide whether `Series.targetSha` advances. A
   * single-repo composer (SCR's own model, `SimulatedComposer`, any test
   * building directly onto `main`) is always `true`. PORT-3's own two-tier
   * `IsomorphicGitComposer`, built onto a feature branch, is `false` --
   * this is the ONE-LINE fix for the false-drift bug PORT-3's own finding
   * surfaced: `main` never actually moved, so the series must not believe
   * it did.
   */
  targetAdvanced: boolean;
}

/**
 * PLAYBOOK-KEEL-SCR-PORT-3_5, Track 1. Sealed (INV-12) only after the real
 * push actually confirms -- never written ahead of the fact. `pushedTip` is
 * the feature-branch tip actually observed on the remote (equal to
 * `LandAuthorised.newTargetSha` in the honest-happy-path case; recorded
 * again here specifically so the log's OWN evidence is "the push confirmed
 * THIS", not an inference from a domain-only event that could have been
 * followed by a crash).
 */
export interface Pushed extends EventBase {
  type: 'Pushed';
  landEventId: string;
  seriesId: string;
  pushedTip: string;
}

/**
 * PLAYBOOK-KEEL-SCR-PORT-3_5, Track 1. Sealed only after the real PR
 * actually opened (or was found already open, on an idempotent resume).
 */
export interface PrOpened extends EventBase {
  type: 'PrOpened';
  landEventId: string;
  seriesId: string;
  prNumber: number;
  prUrl: string;
}

/**
 * Review threads bind exactly as verdicts do: to (changeId, revisionSeq, hunk)
 * and never to a SHA. A thread whose hunk is no longer present in the head
 * revision is ORPHANED — surfaced to the reviewer, never silently dropped.
 */
export interface ThreadOpened extends EventBase {
  type: 'ThreadOpened';
  threadId: string;
  changeId: string;
  revisionSeq: number;
  /** Content address of the hunk being discussed. */
  hunkId: string;
  body: string;
}

export interface CommentAppended extends EventBase {
  type: 'CommentAppended';
  commentId: string;
  threadId: string;
  body: string;
}

export interface ThreadResolved extends EventBase {
  type: 'ThreadResolved';
  threadId: string;
}

export type ReviewEvent =
  | ChangeReparented
  | TargetAdvanced
  | ThreadOpened
  | CommentAppended
  | ThreadResolved
  | SeriesOpened
  | ChangeOpened
  | RevisionAppended
  | VerdictRecorded
  | VerdictStaled
  | VerdictCarriedForward
  | CheckRecorded
  | SeriesReordered
  | ChangeConflicted
  | ChangeAbandoned
  | LandAuthorised
  | Pushed
  | PrOpened;

export type ChangeState =
  | 'DRAFT'
  | 'OPEN'
  | 'REVIEWED'
  | 'STALE'
  | 'CONFLICTED'
  | 'LANDING'
  | 'LANDED'
  | 'ABANDONED';

export class InvariantViolation extends Error {
  invariant: string;

  constructor(invariant: string, message: string) {
    super(`[${invariant}] ${message}`);
    this.name = 'InvariantViolation';
    this.invariant = invariant;
  }
}
