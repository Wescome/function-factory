/**
 * skill/select.ts — BRIEF-KEEL-SKILL-001: pure skill selection. Rows are
 * passed IN (already fetched by the substrate, once per run); this file never
 * reads a store. Pure, substrate-free (D6).
 *
 * INV-SKILL-FROZEN's other half lives here structurally: because this
 * function only CONSUMES rows and returns a plain selection, freezing the
 * result onto an Action (composition's job) and later reading that frozen
 * selection back (replay) never has to call back into this function with a
 * live store — the row-fetch and the selection are already decoupled.
 */
import type { SkillRecord } from "./store";
import type { ErrorClass } from "../effect/errors";
import { classifyTerminal } from "../effect/errors";

export interface SkillConnectorDoc { readonly name: string; readonly description: string; }

export interface SkillSelection {
  /** Active connector-doc overrides for this call's connectors — NOT the
   *  full doc set; the caller merges these over its own builtin/base docs
   *  by connector name (an empty store must stay non-breaking). */
  readonly connectorDocs: readonly SkillConnectorDoc[];
  readonly procedure?: string;
  readonly amendNudge?: string;
  /** Every skill actually selected, as `id@version` — the freeze target
   *  (`Action.skills`). Empty when nothing was selected (an empty store, or
   *  no active row matched). */
  readonly ids: readonly string[];
}

export interface SelectSkillsOptions {
  /** True on any amend (evidence-present) call — OD-SKILL-4, trigger-on-
   *  stall: an amend-prompt nudge only applies once there's a failure to
   *  recover from; a cold start never selects one. */
  readonly amend?: boolean;
  /** Set when the failure that triggered this amend was a classified
   *  connector error (BRIEF-KEEL-EFFECT-SIGNATURE-001 §A1.3). */
  readonly divergenceClass?: ErrorClass;
  /** How many connector-doc candidates to consider per connector. Default 1
   *  (OD-SKILL-4). */
  readonly n?: number;
}

const idOf = (r: SkillRecord): string => `${r.id}@${r.version}`;

export function selectSkills(
  rows: readonly SkillRecord[],
  connectors: readonly string[],
  intent: string,
  opts: SelectSkillsOptions = {},
): SkillSelection {
  const n = Math.max(1, opts.n ?? 1);
  const active = rows.filter((r) => r.status === "active");

  const docRows = active.filter((r) => r.kind === "connector-doc" && connectors.includes(r.key)).slice(0, n);
  const connectorDocs = docRows.map((r) => ({ name: r.key, description: r.content }));

  // OD-SKILL-1: a terminal divergence class means no retry can succeed at
  // all — never hand back a procedure retry for one. (In practice decide()
  // already ESCALATEs before another generate() call happens for a terminal
  // class; this guard makes selectSkills correct on its own terms too, not
  // just correct because the loop never reaches it.)
  const terminal = opts.divergenceClass ? classifyTerminal(opts.divergenceClass) : false;
  const procedureRow = !terminal ? active.find((r) => r.kind === "procedure" && r.key === intent) : undefined;

  const amendRow = opts.amend ? active.find((r) => r.kind === "amend-prompt" && r.key === intent) : undefined;

  const ids = [
    ...docRows.map(idOf),
    ...(procedureRow ? [idOf(procedureRow)] : []),
    ...(amendRow ? [idOf(amendRow)] : []),
  ];

  return { connectorDocs, procedure: procedureRow?.content, amendNudge: amendRow?.content, ids };
}
