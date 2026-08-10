/**
 * PLAYBOOK-KEEL-SCR-PORT-1: lifted from SCR (service.ts), byte-identical
 * except stripped `.ts` import extensions. No invariant logic touched (Track
 * 1: "do not rewrite invariant logic") -- every public method here stays
 * SYNCHRONOUS, which only works because `identity.ts`'s Keyring.sign/verify
 * are synchronous (node:crypto, Track 3) and `EventLog` (log.ts) is a
 * synchronous port -- Track 2's DO-backed adapter must stay synchronous too
 * (DO SQLite's `storage.sql` already is), or this file would need to change.
 */
import {
  InvariantViolation,
  type UnsealedEvent,
  type CheckKind,
  type CheckOutcome,
  type Decision,
  type Hunk,
  type ReviewEvent,
} from './events';
import { carryForwardEligible, hunkId, interdiff, type Transform } from './interdiff';
import type { EventLog } from './log';
import { Model } from './model';
import { AnchorRebaser, type Rebaser } from './rebase';
import { SimulatedComposer, type ComposeLayer, type Composer } from './vcs';
import { StaticTarget, type TargetProbe } from './target';
import { GENESIS, Keyring, digestOf } from './identity';

export interface Policy {
  /**
   * OD-1 — parked with no lean, so it is configuration, not a decision.
   * 'top-only'    : only the topmost landing layer needs a live integrated check.
   * 'every-layer' : every layer in the prefix does. Bisectable, costs N× CI.
   */
  integratedCheckPolicy: 'top-only' | 'every-layer';
}

export const DEFAULT_POLICY: Policy = { integratedCheckPolicy: 'every-layer' };

export class ReviewService {
  #log: EventLog;
  #rebaser: Rebaser;
  #composer: Composer;
  #target: TargetProbe;
  #keyring: Keyring;
  #policy: Policy;
  #seq = 0;
  #clock = 0;

  constructor(
    log: EventLog,
    opts: {
      rebaser?: Rebaser;
      composer?: Composer;
      target?: TargetProbe;
      keyring?: Keyring;
      policy?: Policy;
    } = {},
  ) {
    this.#log = log;
    this.#rebaser = opts.rebaser ?? new AnchorRebaser();
    this.#composer = opts.composer ?? new SimulatedComposer();
    this.#target = opts.target ?? new StaticTarget();
    this.#keyring = opts.keyring ?? new Keyring();
    this.#policy = opts.policy ?? DEFAULT_POLICY;

    // A service is often a fresh process attached to an existing log — a CLI
    // invocation, a worker restart. Resuming the counters from what the log
    // already contains is what keeps eventIds unique across processes, which
    // INV-8 (P1 LOG-UNIQUE) depends on.
    for (const e of this.#log.all()) {
      this.#clock = Math.max(this.#clock, e.at);
      for (const [, n] of JSON.stringify(e).matchAll(/_(\d{4,})\b/g)) {
        this.#seq = Math.max(this.#seq, Number(n));
      }
    }
  }

  get model(): Model {
    return Model.from(this.#log.all());
  }

  #id(prefix: string): string {
    return `${prefix}_${(++this.#seq).toString().padStart(4, '0')}`;
  }

  #envelope(actorId: string) {
    return { eventId: this.#id('ev'), at: ++this.#clock, actorId };
  }

  get keyring(): Keyring {
    return this.#keyring;
  }

  /**
   * INV-12 LOG-IS-SEALED. Every append goes through here: each event is chained
   * to its predecessor's digest and signed by the actor it names. A batch is
   * chained internally and appended atomically, so a land is one link run, not
   * a gap.
   */
  #emit(events: UnsealedEvent[]): void {
    let prev = (this.#log.tail() as { digest?: string } | undefined)?.digest ?? GENESIS;
    const sealed: ReviewEvent[] = [];
    for (const e of events) {
      const digest = digestOf({ ...e, prev }, prev);
      const sig = this.#keyring.sign(e.actorId, digest);
      sealed.push({ ...e, prev, digest, sig } as ReviewEvent);
      prev = digest;
    }
    this.#log.appendAtomic(sealed);
  }

  // ——— series & changes ———

  openSeries(actorId: string, targetRef: string, targetSha: string): string {
    const seriesId = this.#id('ser');
    this.#emit([{
      ...this.#envelope(actorId),
      type: 'SeriesOpened',
      seriesId,
      targetRef,
      targetSha,
    }]);
    return seriesId;
  }

  /** INV-1: the returned ID survives every rebase, reorder and base migration. */
  openChange(
    actorId: string,
    seriesId: string,
    title: string,
    requiredReviewers: string[] = [],
    splitFrom?: string,
    parents?: string[],
  ): string {
    const m = this.model;
    // Default: stack on the current tips, which reproduces linear behaviour for
    // callers that have never heard of the graph. Pass [] for a fresh root, or
    // several ids for a merge point.
    const resolved = parents ?? this.#tips(m, seriesId);
    for (const p of resolved) {
      if (!m.changes.get(p)) throw new InvariantViolation('INV-13', `unknown parent ${p}`);
    }
    const changeId = this.#id('chg');
    this.#emit([{
      ...this.#envelope(actorId),
      type: 'ChangeOpened',
      seriesId,
      changeId,
      title,
      authorId: actorId,
      requiredReviewers,
      splitFrom,
      parents: resolved,
    }]);
    return changeId;
  }

  /** Open changes with no open children: where a new change lands by default. */
  #tips(m: Model, seriesId: string): string[] {
    const open = m.openOrder(seriesId);
    const tips = open.filter((id) => m.childrenOf(id).length === 0);
    // One tip keeps a linear stack linear. Several tips would silently create a
    // merge point nobody asked for, so stack on the most recent one instead.
    return tips.length <= 1 ? tips : [tips[tips.length - 1]!];
  }

  /**
   * INV-7 NO-SILENT-REPARENT · INV-13 ORDER-IS-ACYCLIC.
   *
   * Moving a change in the graph changes its base and the base of everything
   * under it, so the affected verdicts lapse naming the cause.
   */
  reparent(actorId: string, changeId: string, parents: string[]): void {
    const m = this.model;
    if (!m.changes.get(changeId)) {
      throw new InvariantViolation('INV-13', `unknown change ${changeId}`);
    }
    for (const p of parents) {
      if (!m.changes.get(p)) throw new InvariantViolation('INV-13', `unknown parent ${p}`);
    }
    if (m.wouldCycle(changeId, parents)) {
      throw new InvariantViolation(
        'INV-13',
        `${changeId} cannot depend on ${parents.join(',')} — that closes a loop`,
      );
    }

    const before = new Set(m.ancestorsOf(changeId));
    const batch: UnsealedEvent[] = [
      { ...this.#envelope(actorId), type: 'ChangeReparented', changeId, parents },
    ];
    batch.push(...this.#staleAncestryChange(actorId, m, changeId, before));
    this.#emit(batch);
  }

  /** Lapse verdicts on a change and its descendants whose ancestry moved. */
  #staleAncestryChange(
    actorId: string,
    m: Model,
    changeId: string,
    beforeAncestors: Set<string>,
  ): UnsealedEvent[] {
    const out: UnsealedEvent[] = [];
    const touched = [changeId, ...m.descendantsOf(changeId)];
    for (const id of touched) {
      if (id === changeId && beforeAncestors.size === 0) {
        // Still a root: nothing beneath it moved.
      }
      for (const v of m.liveVerdicts(id)) {
        out.push({
          ...this.#envelope(actorId),
          type: 'VerdictStaled',
          verdictId: v.verdictId,
          cause: 'reordered',
        });
      }
    }
    return out;
  }

  /**
   * Append a revision. INV-3: every live verdict is re-evaluated against the
   * new post-image and either carried forward with its interdiff recorded, or
   * lapsed to STALE naming its cause.
   */
  appendRevision(
    actorId: string,
    changeId: string,
    hunks: Hunk[],
    reason = 'author-edit',
    transforms: Transform[] = [],
  ): number {
    const m = this.model;
    const c = m.changes.get(changeId);
    if (!c) throw new InvariantViolation('INV-1', `unknown change ${changeId}`);
    if (c.landed) throw new InvariantViolation('INV-8', `${changeId} already landed`);

    const prior = c.revisions.at(-1);
    const seq = (prior?.seq ?? 0) + 1;
    const batch: UnsealedEvent[] = [
      {
        ...this.#envelope(actorId),
        type: 'RevisionAppended',
        changeId,
        seq,
        hunks,
        reason,
        transforms: transforms.length ? transforms : undefined,
      },
    ];

    if (prior) {
      batch.push(
        ...this.#reevaluate(actorId, m, changeId, prior.hunks, hunks, seq, 'new-revision', {
          transforms,
          reason,
        }),
      );
    }
    this.#emit(batch);
    return seq;
  }

  /** INV-2: bound to (changeId, revisionSeq). No SHA appears in this signature. */
  recordVerdict(
    reviewerId: string,
    changeId: string,
    decision: Decision,
    scope: string[] = [],
  ): string {
    const m = this.model;
    const head = m.head(changeId);
    if (!head) throw new InvariantViolation('INV-2', `${changeId} has no revision to review`);
    const verdictId = this.#id('vd');
    this.#emit([{
      ...this.#envelope(reviewerId),
      type: 'VerdictRecorded',
      verdictId,
      changeId,
      revisionSeq: head.seq,
      reviewerId,
      decision,
      scope,
    }]);
    return verdictId;
  }

  /** INV-4: the caller must present both axes; the service records both. */
  recordCheck(
    actorId: string,
    changeId: string,
    kind: CheckKind,
    outcome: CheckOutcome,
  ): string {
    const m = this.model;
    const head = m.head(changeId);
    if (!head) throw new InvariantViolation('INV-4', `${changeId} has no revision to check`);
    const checkId = this.#id('ck');
    this.#emit([{
      ...this.#envelope(actorId),
      type: 'CheckRecorded',
      checkId,
      changeId,
      revisionSeq: head.seq,
      baseFingerprint: m.baseFingerprintOf(changeId),
      kind,
      outcome,
    }]);
    return checkId;
  }

  /** INV-7: reordering is an operation, never a side effect. */
  reorder(actorId: string, seriesId: string, order: string[]): void {
    const m = this.model;
    const open = m.openOrder(seriesId);
    const same =
      open.length === order.length && [...open].sort().join() === [...order].sort().join();
    if (!same) {
      throw new InvariantViolation('INV-7', 'reorder must be a permutation of the open order');
    }

    const batch: UnsealedEvent[] = [
      { ...this.#envelope(actorId), type: 'SeriesReordered', seriesId, order },
    ];

    // Any change whose ancestor set changed has a new base.
    for (let i = 0; i < order.length; i++) {
      const before = new Set(m.ancestorsOf(order[i]!));
      const after = new Set(order.slice(0, i));
      const changed = before.size !== after.size || [...after].some((id) => !before.has(id));
      if (!changed) continue;
      for (const v of m.liveVerdicts(order[i]!)) {
        batch.push({
          ...this.#envelope(actorId),
          type: 'VerdictStaled',
          verdictId: v.verdictId,
          cause: 'reordered',
        });
      }
    }
    this.#emit(batch);
  }

  /** OD-3: split emits provenance edges and inherits no verdicts. */
  split(actorId: string, changeId: string, scopes: string[][]): string[] {
    const m = this.model;
    const c = m.changes.get(changeId)!;
    const head = m.head(changeId);
    if (!head) throw new InvariantViolation('INV-2', `${changeId} has no revision to split`);
    const ids: string[] = [];
    for (const [i, scope] of scopes.entries()) {
      // The pieces take the split change's place in the graph, in a chain, so
      // its children keep a single thing to depend on.
      const id = this.openChange(
        actorId,
        c.seriesId,
        `${c.title} (${i + 1}/${scopes.length})`,
        c.requiredReviewers,
        changeId,
        i === 0 ? c.parents : [ids[i - 1]!],
      );
      this.appendRevision(
        actorId,
        id,
        head.hunks.filter((h) => scope.includes(h.path)),
        'split',
      );
      ids.push(id);
    }
    this.#emit([{
      ...this.#envelope(actorId),
      type: 'ChangeAbandoned',
      changeId,
      reason: 'split',
    }]);
    return ids;
  }

  // ——— review threads ———

  /** INV-2 again: threads bind to (change, revision, hunk). No SHA. */
  openThread(actorId: string, changeId: string, hunk: Hunk, body: string): string {
    const m = this.model;
    const head = m.head(changeId);
    if (!head) throw new InvariantViolation('INV-2', `${changeId} has no revision`);
    const id = hunkId(hunk);
    if (!head.hunks.some((h) => hunkId(h) === id)) {
      throw new InvariantViolation('INV-2', `hunk not present in ${changeId} rev ${head.seq}`);
    }
    const threadId = this.#id('thr');
    this.#emit([{
      ...this.#envelope(actorId),
      type: 'ThreadOpened',
      threadId,
      changeId,
      revisionSeq: head.seq,
      hunkId: id,
      body,
    }]);
    return threadId;
  }

  reply(actorId: string, threadId: string, body: string): string {
    const commentId = this.#id('cm');
    this.#emit([{
      ...this.#envelope(actorId),
      type: 'CommentAppended',
      commentId,
      threadId,
      body,
    }]);
    return commentId;
  }

  resolveThread(actorId: string, threadId: string): void {
    this.#emit([{ ...this.#envelope(actorId), type: 'ThreadResolved', threadId }]);
  }

  // ——— what a reviewer needs to see before the land, not at it ———

  /**
   * Sibling collision prediction.
   *
   * The compose check that refuses a land (INV-9) is run here continuously and
   * without blocking anything. Two branches can each be clean against their
   * shared parent and irreconcilable with each other; nothing in either branch
   * reveals that, because neither has ever seen the other. This is the view
   * that turns that from a surprise at the end into a fact you can see while
   * the code is still being written.
   *
   * Derived, never stored: it is a statement about the current heads, and it
   * stops being true the moment either side moves.
   */
  collisions(seriesId: string): {
    a: string;
    b: string;
    path: string;
    anchors: string[];
  }[] {
    const m = this.model;
    const open = m.openOrder(seriesId).filter((id) => m.hasContent(id));
    const out: { a: string; b: string; path: string; anchors: string[] }[] = [];

    for (let i = 0; i < open.length; i++) {
      for (let j = i + 1; j < open.length; j++) {
        const a = open[i]!;
        const b = open[j]!;
        // Ancestry is not collision: a descendant was already replayed onto its
        // ancestor, and any clash there is an ordinary CONFLICTED state.
        if (m.ancestorsOf(b).includes(a) || m.ancestorsOf(a).includes(b)) continue;

        const ah = m.head(a)!.hunks;
        const bh = m.head(b)!.hunks;
        if (this.#rebaser.rebase(bh, ah).ok) continue;

        // The rebaser decides *whether*; this reports *where*, so the reviewer
        // gets a file and an anchor rather than a yes.
        const byPath = new Map<string, string[]>();
        for (const x of ah) {
          for (const y of bh) {
            if (x.path === y.path && x.anchor === y.anchor && x.content !== y.content) {
              byPath.set(x.path, [...(byPath.get(x.path) ?? []), x.anchor]);
            }
          }
        }
        for (const [path, anchors] of byPath) out.push({ a, b, path, anchors });
      }
    }
    return out;
  }

  /** Collisions involving one change, for a per-layer view. */
  collisionsFor(seriesId: string, changeId: string) {
    return this.collisions(seriesId)
      .filter((c) => c.a === changeId || c.b === changeId)
      .map((c) => ({ other: c.a === changeId ? c.b : c.a, path: c.path, anchors: c.anchors }));
  }

  /**
   * Where a reviewer should look next: the deepest unreviewed ancestor.
   * Reviewing a merge point before its branches is wasted effort — the merge
   * point's base is those branches, and it will be restated when they move.
   */
  reviewNext(seriesId: string, reviewerId: string): string[] {
    const m = this.model;
    return m.openOrder(seriesId).filter((id) => {
      if (!m.hasContent(id)) return false;
      const mine = m.liveVerdicts(id).some((v) => v.reviewerId === reviewerId);
      if (mine) return false;
      // Only surface a change whose ancestors this reviewer has already cleared.
      return m
        .ancestorsOf(id)
        .filter((p) => m.hasContent(p))
        .every((p) => m.liveVerdicts(p).some((v) => v.reviewerId === reviewerId));
    });
  }

  /**
   * What actually changed under a lapsed verdict.
   *
   * The log records that a verdict went stale and why; the interdiff that
   * caused it is recoverable, because both revisions and the verdict's scope
   * are all there. Nothing derived it until now, so "the reviewer sees
   * precisely what changed under them" was a claim about what the data
   * permitted rather than about anything the system showed.
   */
  whatChanged(verdictId: string): {
    from: number;
    to: number;
    added: Hunk[];
    removed: Hunk[];
  } | null {
    const m = this.model;
    const v = m.verdicts.get(verdictId);
    if (!v) return null;
    const c = m.changes.get(v.changeId);
    const from = c?.revisions.find((r) => r.seq === v.revisionSeq);
    const head = m.head(v.changeId);
    if (!from || !head || head.seq === from.seq) return null;
    const d = interdiff(from.hunks, head.hunks, v.scope);
    return { from: from.seq, to: head.seq, added: d.added, removed: d.removed };
  }

  // ——— the target ref, which this series does not own ———

  /**
   * INV-11. Ask the target ref where it is. If it moved, record the fact and
   * replay every open layer onto what arrived — the same aftermath a partial
   * land produces, because it is the same situation.
   *
   * Verdicts are deliberately *not* stale by default here: an upstream landing
   * does not change the diff a reviewer read. Integrated checks go stale
   * anyway, by construction, because the base fingerprint includes the target
   * SHA. That asymmetry is the two-axis design (INV-4) earning its keep.
   */
  observeTarget(actorId: string, seriesId: string): boolean {
    const m = this.model;
    const s = m.series.get(seriesId);
    if (!s) throw new InvariantViolation('INV-11', `unknown series ${seriesId}`);

    const obs = this.#target.observe(s.targetSha);
    if (obs.sha === s.targetSha) return false;

    const batch: UnsealedEvent[] = [
      {
        ...this.#envelope(actorId),
        type: 'TargetAdvanced',
        seriesId,
        fromSha: s.targetSha,
        toSha: obs.sha,
        incomingHunks: obs.incomingHunks,
      },
    ];
    batch.push(
      ...this.#replay(actorId, m, m.openOrder(seriesId), obs.incomingHunks, obs.sha, 'base-changed'),
    );
    this.#emit(batch);
    return true;
  }

  /**
   * Replay a set of layers onto incoming content. Shared by partial landing and
   * external target movement so the two cannot drift apart.
   */
  #replay(
    actorId: string,
    m: Model,
    layerIds: string[],
    incoming: Hunk[],
    againstBaseFingerprint: string,
    cause: 'base-changed',
  ): UnsealedEvent[] {
    const out: UnsealedEvent[] = [];
    for (const id of layerIds) {
      const head = m.head(id);
      // A DRAFT layer has no content to replay. Nothing to rebase, nothing to stale.
      if (!head) continue;
      const res = this.#rebaser.rebase(head.hunks, incoming);
      if (!res.ok) {
        out.push({
          ...this.#envelope(actorId),
          type: 'ChangeConflicted',
          changeId: id,
          hunk: res.hunk,
          againstBaseFingerprint,
        });
        continue;
      }
      const seq = head.seq + 1;
      out.push({
        ...this.#envelope(actorId),
        type: 'RevisionAppended',
        changeId: id,
        seq,
        hunks: res.hunks,
        reason: 'rebase',
      });
      out.push(...this.#reevaluate(actorId, m, id, head.hunks, res.hunks, seq, cause));
    }
    return out;
  }

  // ——— landing ———

  /**
   * INV-5 prefix only · INV-6 atomic · INV-9 conflict is a state.
   *
   * The Landed event and every downstream rebase consequence are appended as
   * one batch: the review history never observes a half-landed series.
   */
  land(actorId: string, seriesId: string, changeIds: string[]): string {
    const m = this.model;
    const s = m.series.get(seriesId);
    if (!s) throw new InvariantViolation('INV-5', `unknown series ${seriesId}`);

    // INV-11: observe the target before anything else. A land composed against
    // a base the series has not seen is a land whose checks refer to nothing.
    const obs = this.#target.observe(s.targetSha);
    if (obs.sha !== s.targetSha) {
      // The observation is a fact; refusing the land is not a reason to discard
      // it. Record and replay, then refuse — never silently retry onto a base
      // nobody authorised.
      const batch: UnsealedEvent[] = [
        {
          ...this.#envelope(actorId),
          type: 'TargetAdvanced',
          seriesId,
          fromSha: s.targetSha,
          toSha: obs.sha,
          incomingHunks: obs.incomingHunks,
        },
      ];
      batch.push(
        ...this.#replay(
          actorId,
          m,
          m.openOrder(seriesId),
          obs.incomingHunks,
          obs.sha,
          'base-changed',
        ),
      );
      this.#emit(batch);
      throw new InvariantViolation(
        'INV-11',
        `target moved ${s.targetSha.slice(0, 8)} -> ${obs.sha.slice(0, 8)}; re-verify before landing`,
      );
    }

    const open = m.openOrder(seriesId);
    if (changeIds.length === 0) {
      throw new InvariantViolation('INV-5', 'nothing to land');
    }
    if (!m.isDownwardClosed(changeIds)) {
      const missing = [
        ...new Set(
          changeIds.flatMap((id) => m.ancestorsOf(id)).filter((a) => !changeIds.includes(a)),
        ),
      ];
      throw new InvariantViolation(
        'INV-5',
        `not downward-closed: ${changeIds.join(',')} depends on ${missing.join(',')}, which would be left behind`,
      );
    }
    // The caller supplies a set; the order it composes in is ours to choose,
    // and must be the deterministic topological one (INV-13).
    changeIds = open.filter((id) => changeIds.includes(id));

    // ——— preconditions ———
    const verdictIds: string[][] = [];
    const revisionSeqs: number[] = [];

    for (const [i, id] of changeIds.entries()) {
      const c = m.changes.get(id)!;
      if (c.conflicted) throw new InvariantViolation('INV-9', `${id} is CONFLICTED`);
      if (!m.hasContent(id)) {
        throw new InvariantViolation('INV-2', `${id} is DRAFT — nothing to land`);
      }

      const live = m.liveVerdicts(id).filter((v) => v.decision === 'approve');
      if (m.liveVerdicts(id).some((v) => v.decision === 'reject')) {
        throw new InvariantViolation('INV-3', `${id} has a live rejection`);
      }
      for (const r of c.requiredReviewers) {
        if (!live.some((v) => v.reviewerId === r)) {
          throw new InvariantViolation(
            'INV-3',
            `${id} lacks a non-stale approval from required reviewer ${r}`,
          );
        }
      }

      const isTop = i === changeIds.length - 1;
      const needsIntegrated =
        this.#policy.integratedCheckPolicy === 'every-layer' || isTop;
      if (needsIntegrated) {
        const chk = m.liveCheck(id, 'integrated');
        if (!chk) {
          throw new InvariantViolation(
            'INV-4',
            `${id} has no integrated check for (rev ${m.head(id)!.seq}, base ${m
              .baseFingerprintOf(id)
              .slice(0, 8)})`,
          );
        }
        if (chk.outcome === 'fail') {
          throw new InvariantViolation('INV-4', `${id} integrated check failed`);
        }
      }

      verdictIds.push(live.map((v) => v.verdictId));
      revisionSeqs.push(m.head(id)!.seq);
    }

    // ——— the set must compose ———
    // In a linear stack this is free: each layer was already replayed onto the
    // one below. In a diamond it is not — two branches can each be clean
    // against their shared parent and irreconcilable with each other, and this
    // is the moment that surfaces.
    const accumulated: Hunk[] = [];
    for (const id of changeIds) {
      const hunks = m.head(id)!.hunks;
      const res = this.#rebaser.rebase(hunks, accumulated);
      if (!res.ok) {
        throw new InvariantViolation(
          'INV-9',
          `${id} does not compose with its siblings in this set at ${res.hunk.path}:${res.hunk.anchor}`,
        );
      }
      accumulated.push(...hunks);
    }

    // ——— compose ———
    const baseSha = s.targetSha;
    const baseFp = m.baseFingerprintOf(changeIds[0]!);
    const landedHunks = changeIds.flatMap((id) => m.head(id)!.hunks);
    // OD-5: one commit per Change, so landedShas is 1:1 with changeIds.
    const layers: ComposeLayer[] = changeIds.map((id) => {
      const c = m.changes.get(id)!;
      const head = m.head(id)!;
      return {
        changeId: id,
        title: c.title,
        authorId: c.authorId,
        hunks: head.hunks,
        revisionHash: head.hash,
      };
    });
    const composed = this.#composer.compose(baseSha, layers);
    const landedShas = composed.shas;

    const landEventId = this.#id('land');
    const batch: UnsealedEvent[] = [
      {
        ...this.#envelope(actorId),
        type: 'Landed',
        landEventId,
        seriesId,
        changeIds,
        landedShas,
        revisionSeqs,
        verdictIds,
        baseFingerprint: baseFp,
        baseSha,
        newTargetSha: composed.newTargetSha,
      },
    ];

    // ——— aftermath: replay every remaining layer onto what just landed ———
    batch.push(
      ...this.#replay(
        actorId,
        m,
        open.filter((id) => !changeIds.includes(id)),
        landedHunks,
        baseFp,
        'base-changed',
      ),
    );

    this.#emit(batch);
    return landEventId;
  }

  /**
   * INV-3. Shared by author edits and rebases: carry forward only on an empty
   * in-scope interdiff, and record the interdiff hash that justified it.
   */
  #reevaluate(
    actorId: string,
    m: Model,
    changeId: string,
    from: Hunk[],
    to: Hunk[],
    toSeq: number,
    cause: 'new-revision' | 'base-changed',
    opts: { transforms?: Transform[]; reason?: string } = {},
  ): UnsealedEvent[] {
    const out: UnsealedEvent[] = [];
    const transforms = opts.transforms ?? [];

    // INV-14 RESOLUTION-NEVER-CARRIES. Resolved content is content nobody
    // reviewed, however small the resolution was. No transform excuses it.
    const resolving = opts.reason === 'conflict-resolution';

    for (const v of m.liveVerdicts(changeId)) {
      const d = resolving ? null : carryForwardEligible(from, to, v.scope, transforms);
      if (d) {
        out.push({
          ...this.#envelope(actorId),
          type: 'VerdictCarriedForward',
          fromVerdictId: v.verdictId,
          verdictId: this.#id('vd'),
          changeId,
          toRevisionSeq: toSeq,
          interdiffHash: d.interdiff.hash,
          scope: d.scope,
          transforms: transforms.length ? transforms : undefined,
        });
      } else {
        out.push({
          ...this.#envelope(actorId),
          type: 'VerdictStaled',
          verdictId: v.verdictId,
          cause,
        });
      }
    }
    return out;
  }

  // ——— the query the whole design exists to answer ———

  /**
   * What exactly was reviewed, by whom, at which revision, when this shipped?
   * Answered from the LandEvent. The git log is not consulted, because it has
   * been rewritten and is not evidence.
   */
  provenanceOf(sha: string): {
    changeId: string;
    revisionSeq: number;
    revisionHash: string;
    authorId: string;
    reviewers: { reviewerId: string; verdictId: string; carriedFrom?: string }[];
    landedAt: number;
    landEventId: string;
  } | null {
    const m = this.model;
    for (const l of m.lands) {
      const i = l.landedShas.indexOf(sha);
      if (i === -1) continue;
      const c = m.changes.get(l.changeIds[i]!)!;
      return {
        changeId: c.changeId,
        revisionSeq: l.revisionSeqs[i]!,
        revisionHash: c.revisions.find((r) => r.seq === l.revisionSeqs[i])!.hash,
        authorId: c.authorId,
        reviewers: l.verdictIds[i]!.map((vid) => {
          const v = m.verdicts.get(vid)!;
          return { reviewerId: v.reviewerId, verdictId: vid, carriedFrom: v.carriedFrom };
        }),
        landedAt: l.at,
        landEventId: l.landEventId,
      };
    }
    return null;
  }
}
