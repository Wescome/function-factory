/**
 * PLAYBOOK-KEEL-SCR-PORT-1: lifted from SCR (audit.ts), byte-identical
 * except stripped `.ts` import extensions.
 */
import type { ReviewEvent } from './events';
import { Model } from './model';
import { verifyChain, type Keyring } from './identity';

export interface Violation {
  property: string;
  invariant: string;
  detail: string;
}

/**
 * Whole-history conformance check.
 *
 * The unit suite proves each invariant on a hand-built scenario. This proves
 * them over *any* history, including ones nobody thought to write down. It is
 * the check the property suite runs after every single accepted command.
 *
 * Everything here is evaluated by replaying the log forward, because several
 * properties (P5, P9) are statements about the state that existed at the moment
 * a land was authorised, not about the state now.
 */
export function audit(events: ReviewEvent[], opts: { keyring?: Keyring } = {}): Violation[] {
  const v: Violation[] = [];

  // INV-12: is this log the one that was written? Chain and content binding are
  // checkable with no keys at all; attribution needs the keyring.
  v.push(...verifyChain(events, opts.keyring));
  const push = (property: string, invariant: string, detail: string) =>
    v.push({ property, invariant, detail });

  // ——— P1: the log itself ———
  const seen = new Set<string>();
  for (const e of events) {
    if (seen.has(e.eventId)) {
      push('P1 LOG-UNIQUE', 'INV-8', `duplicate eventId ${e.eventId}`);
    }
    seen.add(e.eventId);
  }

  // ——— replay ———
  const m = new Model();
  const carriedFrom = new Set<string>();
  const landedChanges = new Set<string>();

  for (const e of events) {
    if (e.type === 'VerdictCarriedForward') carriedFrom.add(e.fromVerdictId);

    if (e.type === 'LandAuthorised') {
      // Evaluated against the state *before* the land is applied.
      const series = m.series.get(e.seriesId);

      // P13: nothing composes against a base the series had not observed.
      if (series && series.targetSha !== e.baseSha) {
        push(
          'P13 FENCED',
          'INV-11',
          `${e.landEventId} composed against ${e.baseSha.slice(0, 8)} while the series was at ${series.targetSha.slice(0, 8)}`,
        );
      }

      const openBefore = m.openOrder(e.seriesId);

      // P2: a land is downward-closed — never leaves an ancestor behind.
      if (!m.isDownwardClosed(e.changeIds)) {
        const missing = [
          ...new Set(
            e.changeIds.flatMap((id) => m.ancestorsOf(id)).filter((a) => !e.changeIds.includes(a)),
          ),
        ];
        push(
          'P2 DOWNWARD-CLOSED',
          'INV-5',
          `${e.landEventId} landed ${e.changeIds.join(',')} while ${missing.join(',')} was still open beneath it`,
        );
      }

      // P2b: and it composed in topological order.
      const expected = openBefore.filter((id) => e.changeIds.includes(id));
      if (expected.join() !== e.changeIds.join()) {
        push(
          'P2 DOWNWARD-CLOSED',
          'INV-13',
          `${e.landEventId} composed ${e.changeIds.join(',')}, not the topological order ${expected.join(',')}`,
        );
      }

      // P3: the LandEvent is complete — every parallel array agrees.
      const n = e.changeIds.length;
      if (
        e.landedShas.length !== n ||
        e.revisionSeqs.length !== n ||
        e.verdictIds.length !== n
      ) {
        push('P3 LAND-COMPLETE', 'INV-6', `${e.landEventId} has ragged arrays`);
      }

      for (const [i, id] of e.changeIds.entries()) {
        const c = m.changes.get(id);
        if (!c) {
          push('P4 LAND-RESOLVES', 'INV-1', `${e.landEventId} names unknown change ${id}`);
          continue;
        }

        // P4: the revision recorded as landed must actually exist.
        if (!c.revisions.some((r) => r.seq === e.revisionSeqs[i])) {
          push(
            'P4 LAND-RESOLVES',
            'INV-2',
            `${id} landed at revision ${e.revisionSeqs[i]}, which does not exist`,
          );
        }

        // P5: no change lands twice.
        if (landedChanges.has(id)) {
          push('P5 LAND-ONCE', 'INV-8', `${id} landed more than once`);
        }
        landedChanges.add(id);

        // P6: nothing lands while CONFLICTED.
        if (c.conflicted) {
          push('P6 NO-CONFLICTED-LAND', 'INV-9', `${id} landed while CONFLICTED`);
        }

        // P7: every required reviewer had a live, non-stale approval.
        for (const r of c.requiredReviewers) {
          const ok = e.verdictIds[i]!.some((vid) => {
            const vd = m.verdicts.get(vid);
            return (
              vd &&
              vd.reviewerId === r &&
              vd.decision === 'approve' &&
              !vd.stale &&
              vd.revisionSeq === e.revisionSeqs[i]
            );
          });
          if (!ok) {
            push(
              'P7 AUTHORISED',
              'INV-3',
              `${id} landed without a live approval from required reviewer ${r}`,
            );
          }
        }
      }
    }

    m.apply(e);
  }

  // ——— P21: every carry-forward names a verdict that exists ———
  const verdictIdsSeen = new Set(
    events.filter((e) => e.type === 'VerdictRecorded' || e.type === 'VerdictCarriedForward')
      .map((e) => (e as { verdictId: string }).verdictId),
  );
  for (const e of events) {
    if (e.type !== 'VerdictCarriedForward') continue;
    if (!verdictIdsSeen.has(e.fromVerdictId)) {
      push(
        'P21 CARRY-RESOLVES',
        'INV-3',
        `${e.verdictId} carries forward from ${e.fromVerdictId}, which was never recorded`,
      );
    }
  }

  // ——— P20: no approval carries across a conflict resolution (INV-14) ———
  const resolutions = new Set(
    events
      .filter((e) => e.type === 'RevisionAppended' && e.reason === 'conflict-resolution')
      .map((e) => `${(e as { changeId: string }).changeId}@${(e as { seq: number }).seq}`),
  );
  for (const e of events) {
    if (e.type !== 'VerdictCarriedForward') continue;
    if (resolutions.has(`${e.changeId}@${e.toRevisionSeq}`)) {
      push(
        'P20 RESOLUTION-NEVER-CARRIES',
        'INV-14',
        `${e.verdictId} carried an approval onto ${e.changeId} rev ${e.toRevisionSeq}, which is resolved content nobody reviewed`,
      );
    }
  }

  // ——— P8: no verdict silently outlives its revision ———
  for (const vd of m.verdicts.values()) {
    const c = m.changes.get(vd.changeId);
    if (!c || c.revisions.length === 0) continue;
    const headSeq = c.revisions.at(-1)!.seq;
    if (vd.revisionSeq === headSeq || vd.stale) continue;
    if (!carriedFrom.has(vd.verdictId)) {
      push(
        'P8 NO-ORPHAN-APPROVAL',
        'INV-3',
        `${vd.verdictId} sits on revision ${vd.revisionSeq} (head ${headSeq}) neither stale nor carried forward`,
      );
    }
  }

  // ——— P18: the graph is a graph, not a knot ———
  for (const ser of m.series.values()) {
    const openNodes = ser.members.filter((id) => {
      const c = m.changes.get(id)!;
      return !c.landed && !c.abandoned;
    });
    const ordered = m.openOrder(ser.seriesId);
    for (const id of openNodes) {
      if (m.ancestorsOf(id).includes(id)) {
        push('P18 ACYCLIC', 'INV-13', `${id} is its own ancestor`);
      }
    }
    // A cycle strands nodes, which openOrder appends rather than drops.
    const seen = new Set<string>();
    for (const id of ordered) {
      if (m.ancestorsOf(id).some((a) => !seen.has(a) && ordered.includes(a))) {
        push('P18 ACYCLIC', 'INV-13', `${id} precedes an ancestor in topological order`);
      }
      seen.add(id);
    }
  }

  // ——— P19: every parent named actually exists ———
  for (const c of m.changes.values()) {
    for (const p of c.parents) {
      if (!m.changes.has(p)) {
        push('P19 PARENTS-RESOLVE', 'INV-13', `${c.changeId} names unknown parent ${p}`);
      }
    }
  }

  // ——— P9: identity and attribution are stable ———
  for (const c of m.changes.values()) {
    if (!c.authorId) push('P9 ATTRIBUTED', 'INV-10', `${c.changeId} has no author`);
    if (c.landed && c.abandoned) {
      push('P10 EXCLUSIVE-TERMINAL', 'INV-1', `${c.changeId} is both landed and abandoned`);
    }
  }

  // ——— P11: every landed SHA is 1:1 with a change (OD-5) ———
  const shas = new Map<string, string>();
  for (const l of m.lands) {
    for (const [i, s] of l.landedShas.entries()) {
      if (shas.has(s)) {
        push('P11 SHA-UNIQUE', 'INV-2', `sha ${s.slice(0, 8)} maps to two changes`);
      }
      shas.set(s, l.changeIds[i]!);
    }
  }

  // ——— P12: check validity is never asserted across bases ———
  for (const chk of m.checks) {
    const c = m.changes.get(chk.changeId);
    if (!c) push('P12 CHECK-RESOLVES', 'INV-4', `check ${chk.checkId} names unknown change`);
    else if (!c.revisions.some((r) => r.seq === chk.revisionSeq)) {
      push(
        'P12 CHECK-RESOLVES',
        'INV-4',
        `check ${chk.checkId} names revision ${chk.revisionSeq}, which does not exist`,
      );
    }
  }

  return v;
}

export function assertClean(events: ReviewEvent[], opts: { keyring?: Keyring } = {}): void {
  const v = audit(events, opts);
  if (v.length) {
    throw new Error(
      `audit failed:\n` + v.map((x) => `  ${x.property} [${x.invariant}] ${x.detail}`).join('\n'),
    );
  }
}
