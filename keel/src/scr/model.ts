/**
 * PLAYBOOK-KEEL-SCR-PORT-1: lifted from SCR (model.ts), byte-identical
 * except stripped `.ts` import extensions.
 */
import type {
  ChangeState,
  CheckKind,
  CheckOutcome,
  Decision,
  Hunk,
  ReviewEvent,
  StaleCause,
} from './events';
import { baseFingerprint, hunkId, revisionHash } from './interdiff';

export interface Revision {
  seq: number;
  hunks: Hunk[];
  hash: string;
  reason: string;
}

export interface Verdict {
  verdictId: string;
  changeId: string;
  revisionSeq: number;
  reviewerId: string;
  decision: Decision;
  scope: string[];
  stale: boolean;
  staleCause?: StaleCause;
  carriedFrom?: string;
}

export interface Check {
  checkId: string;
  changeId: string;
  revisionSeq: number;
  baseFingerprint: string;
  kind: CheckKind;
  outcome: CheckOutcome;
}

export type ThreadStatus = 'LIVE' | 'ORPHANED' | 'RESOLVED';

export interface Thread {
  threadId: string;
  changeId: string;
  revisionSeq: number;
  hunkId: string;
  comments: { commentId: string; actorId: string; body: string; at: number }[];
  resolved: boolean;
}

export interface Change {
  changeId: string;
  seriesId: string;
  title: string;
  /** INV-10: never mutated by reparenting. */
  authorId: string;
  /** Changes this one builds on. Empty means it sits on the target. */
  parents: string[];
  requiredReviewers: string[];
  revisions: Revision[];
  landed: boolean;
  abandoned: boolean;
  conflicted: boolean;
  splitFrom?: string;
}

export interface Series {
  seriesId: string;
  targetRef: string;
  targetSha: string;
  /**
   * Every change ever opened in this series, in the order it was opened. The
   * *shape* lives in each change's `parents`; this list only supplies a stable
   * tiebreak so that topological order is deterministic (INV-13).
   */
  members: string[];
  landedCount: number;
}

/**
 * PLAYBOOK-KEEL-SCR-PORT-3_5, Track 1: SCR's `PARTIALLY-PROPAGATED`, folded.
 * One record per `LandAuthorised`, with `Pushed`/`PrOpened` folded into its
 * `status` and confirmation fields as they arrive. `status` is DERIVED,
 * never asserted ahead of the fact -- it is exactly "which sealed events
 * exist for this landEventId", nothing inferred, nothing anticipated.
 */
export type LandStatus = 'AUTHORISED' | 'PUSHED' | 'PR_OPENED';

export interface LandRecord {
  landEventId: string;
  seriesId: string;
  changeIds: string[];
  landedShas: string[];
  revisionSeqs: number[];
  verdictIds: string[][];
  baseFingerprint: string;
  baseSha: string;
  newTargetSha: string;
  targetAdvanced: boolean;
  at: number;
  status: LandStatus;
  pushedTip?: string;
  pr?: { number: number; url: string };
}

export class Model {
  series = new Map<string, Series>();
  changes = new Map<string, Change>();
  verdicts = new Map<string, Verdict>();
  checks: Check[] = [];
  threads = new Map<string, Thread>();
  lands: LandRecord[] = [];

  /** O(1)-ish lookup by landEventId -- small N, linear scan is plenty. */
  landRecord(landEventId: string): LandRecord | undefined {
    return this.lands.find((l) => l.landEventId === landEventId);
  }

  static from(events: ReviewEvent[]): Model {
    const m = new Model();
    for (const e of events) m.apply(e);
    return m;
  }

  apply(e: ReviewEvent): void {
    switch (e.type) {
      case 'ThreadOpened':
        this.threads.set(e.threadId, {
          threadId: e.threadId,
          changeId: e.changeId,
          revisionSeq: e.revisionSeq,
          hunkId: e.hunkId,
          comments: [{ commentId: e.eventId, actorId: e.actorId, body: e.body, at: e.at }],
          resolved: false,
        });
        break;

      case 'CommentAppended': {
        const t = this.threads.get(e.threadId);
        if (!t) break;
        this.threads.set(e.threadId, {
          ...t,
          comments: [
            ...t.comments,
            { commentId: e.commentId, actorId: e.actorId, body: e.body, at: e.at },
          ],
        });
        break;
      }

      case 'ThreadResolved': {
        const t = this.threads.get(e.threadId);
        if (!t) break;
        this.threads.set(e.threadId, { ...t, resolved: true });
        break;
      }

      case 'SeriesOpened':
        this.series.set(e.seriesId, {
          seriesId: e.seriesId,
          targetRef: e.targetRef,
          targetSha: e.targetSha,
          members: [],
          landedCount: 0,
        });
        break;

      case 'ChangeOpened': {
        if (!this.series.has(e.seriesId)) break;
        this.changes.set(e.changeId, {
          changeId: e.changeId,
          seriesId: e.seriesId,
          title: e.title,
          authorId: e.authorId,
          requiredReviewers: e.requiredReviewers,
          revisions: [],
          landed: false,
          abandoned: false,
          conflicted: false,
          splitFrom: e.splitFrom,
          parents: e.parents ?? [],
        });
        this.series.get(e.seriesId)!.members.push(e.changeId);
        break;
      }

      case 'RevisionAppended': {
        const c = this.changes.get(e.changeId);
        if (!c) break;
        c.revisions.push({
          seq: e.seq,
          hunks: e.hunks,
          hash: revisionHash(e.hunks),
          reason: e.reason,
        });
        c.conflicted = false;
        break;
      }

      case 'VerdictRecorded':
        this.verdicts.set(e.verdictId, {
          verdictId: e.verdictId,
          changeId: e.changeId,
          revisionSeq: e.revisionSeq,
          reviewerId: e.reviewerId,
          decision: e.decision,
          scope: e.scope,
          stale: false,
        });
        break;

      case 'VerdictStaled': {
        const v = this.verdicts.get(e.verdictId);
        if (!v) break;
        // The prior fact is not erased; a superseding fact is recorded.
        this.verdicts.set(e.verdictId, { ...v, stale: true, staleCause: e.cause });
        break;
      }

      case 'VerdictCarriedForward': {
        const src = this.verdicts.get(e.fromVerdictId);
        if (!src) break;
        this.verdicts.set(e.verdictId, {
          ...src,
          verdictId: e.verdictId,
          scope: e.scope ?? src.scope,
          revisionSeq: e.toRevisionSeq,
          stale: false,
          staleCause: undefined,
          carriedFrom: e.fromVerdictId,
        });
        break;
      }

      case 'CheckRecorded':
        this.checks.push({
          checkId: e.checkId,
          changeId: e.changeId,
          revisionSeq: e.revisionSeq,
          baseFingerprint: e.baseFingerprint,
          kind: e.kind,
          outcome: e.outcome,
        });
        break;

      case 'TargetAdvanced': {
        const s = this.series.get(e.seriesId);
        if (s) s.targetSha = e.toSha;
        break;
      }

      case 'ChangeReparented': {
        const c = this.changes.get(e.changeId);
        if (c) c.parents = [...e.parents];
        break;
      }

      case 'SeriesReordered':
        // Linear sugar: rewrite the graph into a chain in the given order.
        e.order.forEach((id, i) => {
          const c = this.changes.get(id);
          if (c) c.parents = i === 0 ? [] : [e.order[i - 1]!];
        });
        break;

      case 'ChangeConflicted': {
        const c = this.changes.get(e.changeId);
        if (c) c.conflicted = true;
        break;
      }

      case 'ChangeAbandoned': {
        const c = this.changes.get(e.changeId);
        if (c) c.abandoned = true;
        break;
      }

      case 'LandAuthorised': {
        const s = this.series.get(e.seriesId);
        if (!s) break;
        for (const id of e.changeIds) {
          const c = this.changes.get(id);
          if (c) c.landed = true;
        }
        // PLAYBOOK-KEEL-SCR-PORT-3_5, Track 2 (the false-drift fix): the
        // series's own composition floor only advances when the compose
        // step reports it moved the REAL target, not a two-tier land's
        // still-unmerged feature branch. This is the entire fix -- INV-11's
        // fence (land()/observeTarget(), unchanged below) compares against
        // `s.targetSha`, so a value that only ever reflects confirmed
        // reality is what makes the fence correct for both tiers.
        if (e.targetAdvanced) s.targetSha = e.newTargetSha;
        s.landedCount += e.changeIds.length;
        this.lands.push({
          landEventId: e.landEventId,
          seriesId: e.seriesId,
          changeIds: e.changeIds,
          landedShas: e.landedShas,
          revisionSeqs: e.revisionSeqs,
          verdictIds: e.verdictIds,
          baseFingerprint: e.baseFingerprint,
          baseSha: e.baseSha,
          newTargetSha: e.newTargetSha,
          targetAdvanced: e.targetAdvanced,
          at: e.at,
          status: 'AUTHORISED',
        });
        break;
      }

      case 'Pushed': {
        const rec = this.landRecord(e.landEventId);
        if (rec) {
          rec.status = 'PUSHED';
          rec.pushedTip = e.pushedTip;
        }
        break;
      }

      case 'PrOpened': {
        const rec = this.landRecord(e.landEventId);
        if (rec) {
          rec.status = 'PR_OPENED';
          rec.pr = { number: e.prNumber, url: e.prUrl };
        }
        break;
      }
    }
  }

  // ——— derived views ———

  /** Undefined for a DRAFT change: opened, not yet revised. */
  head(changeId: string): Revision | undefined {
    const c = this.changes.get(changeId);
    return c?.revisions[c.revisions.length - 1];
  }

  /** A change with no revision contributes no content to anything. */
  hasContent(changeId: string): boolean {
    return !!this.head(changeId);
  }

  /** Is this change still part of the open graph? */
  #isOpen(id: string): boolean {
    const c = this.changes.get(id);
    return !!c && !c.landed && !c.abandoned;
  }

  /** Open parents. Landed parents are in the target now, not in the graph. */
  parentsOf(changeId: string): string[] {
    return (this.changes.get(changeId)?.parents ?? []).filter((p) => this.#isOpen(p));
  }

  childrenOf(changeId: string): string[] {
    const c = this.changes.get(changeId)!;
    return this.series
      .get(c.seriesId)!
      .members.filter((id) => this.#isOpen(id) && this.parentsOf(id).includes(changeId));
  }

  /** Transitive open ancestors, nearest first within each level. */
  ancestorsOf(changeId: string): string[] {
    const out = new Set<string>();
    const walk = (id: string) => {
      for (const p of this.parentsOf(id)) {
        if (out.has(p)) continue;
        out.add(p);
        walk(p);
      }
    };
    walk(changeId);
    return [...out];
  }

  descendantsOf(changeId: string): string[] {
    const out = new Set<string>();
    const walk = (id: string) => {
      for (const c of this.childrenOf(id)) {
        if (out.has(c)) continue;
        out.add(c);
        walk(c);
      }
    };
    walk(changeId);
    return [...out];
  }

  /**
   * Deterministic topological order of the open graph.
   *
   * Kahn's algorithm, with ties broken by the order changes were opened. A DAG
   * admits many valid linearisations; a base fingerprint that depends on which
   * one you happened to compute would make INV-4 meaningless, so the tiebreak
   * is not optional.
   */
  openOrder(seriesId: string): string[] {
    const s = this.series.get(seriesId);
    if (!s) return [];
    const nodes = s.members.filter((id) => this.#isOpen(id));
    const rank = new Map(nodes.map((id, i) => [id, i]));
    const indeg = new Map(nodes.map((id) => [id, this.parentsOf(id).length]));

    const ready = nodes.filter((id) => indeg.get(id) === 0).sort((a, b) => rank.get(a)! - rank.get(b)!);
    const out: string[] = [];
    while (ready.length) {
      const id = ready.shift()!;
      out.push(id);
      for (const child of this.childrenOf(id)) {
        const n = indeg.get(child)! - 1;
        indeg.set(child, n);
        if (n === 0) {
          ready.push(child);
          ready.sort((a, b) => rank.get(a)! - rank.get(b)!);
        }
      }
    }
    // A cycle would strand nodes. INV-13 refuses to create one; if the log
    // somehow contains it, the stranded nodes are reported rather than dropped.
    if (out.length !== nodes.length) {
      out.push(...nodes.filter((id) => !out.includes(id)));
    }
    return out;
  }

  /** Would adding these parents to this change close a loop? INV-13. */
  wouldCycle(changeId: string, parents: string[]): boolean {
    return parents.some((p) => p === changeId || this.ancestorsOf(p).includes(changeId));
  }

  /**
   * INV-5, generalised. A landing set must be closed under ancestry: you may
   * land any set whose every open ancestor is also in the set. In a linear
   * series that is exactly a contiguous prefix.
   */
  isDownwardClosed(ids: string[]): boolean {
    const set = new Set(ids);
    return ids.every((id) => this.ancestorsOf(id).every((a) => set.has(a)));
  }

  /**
   * INV-4 axis 2. Base of a change = target SHA + exact content of every open
   * layer beneath it. Purely derived, so a lower-layer edit invalidates upper
   * integrated checks with no event and no heuristic.
   */
  baseFingerprintOf(changeId: string): string {
    const c = this.changes.get(changeId)!;
    const s = this.series.get(c.seriesId)!;
    // Ancestors, not "everything below" — in a DAG a sibling branch is not part
    // of this change's base, and including it would stale checks for no reason.
    const anc = new Set(this.ancestorsOf(changeId));
    const lower = this.openOrder(c.seriesId)
      .filter((id) => anc.has(id) && this.hasContent(id))
      .map((id) => {
        const r = this.head(id)!;
        return { changeId: id, revisionSeq: r.seq, revisionHash: r.hash };
      });
    return baseFingerprint(s.targetSha, lower);
  }

  /** Verdicts currently attached to a change's head revision and not stale. */
  liveVerdicts(changeId: string): Verdict[] {
    const head = this.head(changeId);
    if (!head) return [];
    return [...this.verdicts.values()].filter(
      (v) => v.changeId === changeId && v.revisionSeq === head.seq && !v.stale,
    );
  }

  /** INV-4: a check counts only on the exact (revision, base) pair in force now. */
  liveCheck(changeId: string, kind: CheckKind): Check | undefined {
    const head = this.head(changeId);
    if (!head) return undefined;
    const bfp = this.baseFingerprintOf(changeId);
    return [...this.checks]
      .reverse()
      .find(
        (c) =>
          c.changeId === changeId &&
          c.kind === kind &&
          c.revisionSeq === head.seq &&
          c.baseFingerprint === bfp,
      );
  }

  /**
   * Derived, like check validity: the thread's anchor either still exists in
   * the head revision or it does not. No event is needed to orphan a thread,
   * and none can hide that it happened.
   */
  threadStatus(threadId: string): ThreadStatus {
    const t = this.threads.get(threadId)!;
    if (t.resolved) return 'RESOLVED';
    const present = (this.head(t.changeId)?.hunks ?? []).some((h) => hunkId(h) === t.hunkId);
    return present ? 'LIVE' : 'ORPHANED';
  }

  /** Threads on a change, with their current status. */
  threadsOn(changeId: string): { thread: Thread; status: ThreadStatus }[] {
    return [...this.threads.values()]
      .filter((t) => t.changeId === changeId)
      .map((t) => ({ thread: t, status: this.threadStatus(t.threadId) }));
  }

  state(changeId: string): ChangeState {
    const c = this.changes.get(changeId)!;
    if (c.abandoned) return 'ABANDONED';
    if (c.landed) return 'LANDED';
    if (c.conflicted) return 'CONFLICTED';
    if (c.revisions.length === 0) return 'DRAFT';

    const head = this.head(changeId)!;
    const everApproved = [...this.verdicts.values()].some(
      (v) => v.changeId === changeId && v.decision === 'approve',
    );
    const approvals = this.liveVerdicts(changeId).filter((v) => v.decision === 'approve');
    const satisfied = c.requiredReviewers.every((r) =>
      approvals.some((v) => v.reviewerId === r),
    );

    if (satisfied && c.requiredReviewers.length > 0) return 'REVIEWED';
    // INV-3: a lapsed verdict lands in STALE, never silently back to unreviewed.
    if (everApproved && !approvals.some((v) => v.revisionSeq === head.seq)) return 'STALE';
    return 'OPEN';
  }
}
