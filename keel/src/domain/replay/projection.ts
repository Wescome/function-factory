/**
 * projection.ts — THE REPLAY / READ-SIDE PROJECTION (Ring 1, substrate-free).
 *
 * Reconstructs a run from its append-only lineage (events + nodes) and proves
 * the record is replay-deterministic: re-running decide() over the recorded
 * verdicts reproduces the exact AMEND/ACCEPT/ESCALATE the live loop took. Pure;
 * imports only domain types + decide(), so it stays in the domain (D6).
 *
 * This is the CQRS read side (D4): the write side (the loop) appends nodes and
 * events; this projects them into timelines, state-at-index snapshots, and
 * cross-run records — never mutating anything.
 */

import { decide } from "../loop/decide";
import type { LoopState } from "../loop/state";
import type { DomainEvent } from "../lineage/events";
import type { AnyNode, VerdictOutcome } from "../lineage/nodes";
import type { ContentHash } from "../lineage/contract";

/** Each recorded event corresponds to one loop state. */
export function eventToState(e: DomainEvent): LoopState {
  switch (e.type) {
    case "RunAdmitted": return "INTENT";
    case "ActionGenerated": return "GENERATE";
    case "ExecutionRecorded": return "EXECUTE";
    case "ActionPaused": return "PAUSE";
    case "VerdictEmitted": return "VERIFY";
    case "AmendmentRequested": return "AMEND";
    case "RunAccepted": return "ACCEPT";
    case "RunEscalated": return "ESCALATE";
    default: {
      const _never: never = e;
      return _never;
    }
  }
}

export interface TimelineEntry {
  readonly index: number;
  readonly type: DomainEvent["type"];
  readonly state: LoopState;
  readonly at: number;
}

export function timeline(events: readonly DomainEvent[]): TimelineEntry[] {
  return events.map((e, index) => ({ index, type: e.type, state: eventToState(e), at: e.at }));
}

/** The node id an event introduces (null for events that reference prior nodes). */
function introducedId(e: DomainEvent): ContentHash | null {
  switch (e.type) {
    case "RunAdmitted": return e.specification;
    case "ActionGenerated": return e.action;
    case "ExecutionRecorded": return e.trace;
    case "VerdictEmitted": return e.verdict;
    case "AmendmentRequested": return e.amendment;
    default: return null;
  }
}

export interface ReplaySnapshot {
  readonly index: number;
  readonly state: LoopState;
  readonly presentNodeIds: readonly ContentHash[];
  readonly presentKinds: readonly string[];
}

/** Reconstruct the run's state and the subgraph that existed at event `index`.
 *  "Replay from any state" = valid for any 0 <= index < events.length. */
export function replayTo(events: readonly DomainEvent[], nodes: readonly AnyNode[], index: number): ReplaySnapshot {
  const kindById = new Map<ContentHash, string>(nodes.map((n) => [n.id, n.kind]));
  const ids: ContentHash[] = [];
  const upto = Math.min(index, events.length - 1);
  for (let i = 0; i <= upto; i++) {
    const e = events[i];
    if (!e) continue;
    const id = introducedId(e);
    if (id && !ids.includes(id)) ids.push(id);
  }
  const cur = events[Math.max(0, Math.min(index, events.length - 1))];
  const state: LoopState = cur ? eventToState(cur) : "INTENT";
  return { index, state, presentNodeIds: ids, presentKinds: ids.map((id) => kindById.get(id) ?? "?") };
}

export interface ReplayConsistency {
  readonly consistent: boolean;
  readonly steps: number;
  readonly reason?: string;
}

/**
 * The core G5 proof: walk the recorded verdicts in order, re-derive decide()
 * for each, and confirm the next governance event recorded matches what
 * decide() predicts. If every decision reproduces, the run is replay-
 * deterministic — the append-only record alone is sufficient to re-derive the
 * loop's control flow.
 */
export function verifyReplay(events: readonly DomainEvent[], budget: number): ReplayConsistency {
  let steps = 0;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (!e || e.type !== "VerdictEmitted") continue;
    steps++;
    const d = decide({ verdict: e.outcome as VerdictOutcome, attempt: e.attempt, budget });
    const next = events.slice(i + 1).find(
      (x) => x.type === "AmendmentRequested" || x.type === "RunAccepted" || x.type === "RunEscalated",
    );
    if (!next) return { consistent: false, steps, reason: `verdict at ${i} has no following decision event` };
    const expected = d.next === "AMEND" ? "AmendmentRequested" : d.next === "ACCEPT" ? "RunAccepted" : "RunEscalated";
    if (next.type !== expected) {
      return { consistent: false, steps, reason: `verdict at ${i}: decide()=${d.next} but recorded ${next.type}` };
    }
  }
  return { consistent: true, steps };
}

export type Terminal = "ACCEPT" | "ESCALATE" | "PAUSE" | "in-flight";

export interface CrossRunRecord {
  readonly runId: ContentHash;
  readonly intent: string;
  readonly terminal: Terminal;
  readonly attempts: number;
  readonly nodeCounts: Readonly<Record<string, number>>;
  /** Phase 6a spec-loop (additive, optional): set only for a derived run, by the
   *  wiring that admitted it into its own DO — NOT by crossRunRecord() itself,
   *  which stays untouched. Lets the cross-run index reconstruct the derivation
   *  tree without any in-DO edge crossing DO boundaries. */
  readonly dependsOn?: { readonly parent: string; readonly root: string };
}

/** The cross-run projection (CQRS read model, destined for D1 in production). */
export function crossRunRecord(
  runId: ContentHash, intent: string,
  events: readonly DomainEvent[], nodes: readonly AnyNode[],
): CrossRunRecord {
  const attempts = events.filter((e) => e.type === "VerdictEmitted").length;
  const accepted = events.some((e) => e.type === "RunAccepted");
  const escalated = events.some((e) => e.type === "RunEscalated");
  const paused = events.some((e) => e.type === "ActionPaused");
  const terminal: Terminal = accepted ? "ACCEPT" : escalated ? "ESCALATE" : paused ? "PAUSE" : "in-flight";
  const nodeCounts: Record<string, number> = {};
  for (const n of nodes) nodeCounts[n.kind] = (nodeCounts[n.kind] ?? 0) + 1;
  return { runId, intent, terminal, attempts, nodeCounts };
}
