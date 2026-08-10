/**
 * PLAYBOOK-KEEL-SCR-PORT-1, Track 2 (OD-PORT-3): the review log's own,
 * distinct Durable Object -- deliberately NOT folded into `Orchestrator`'s
 * DO. "No boundary" (this playbook's own scope): nothing here is wired to
 * KEEL's run/lineage log yet (that join is PORT-4).
 *
 * Deliberately minimal / no RPC surface yet. `ReviewService` (src/scr/
 * service.ts) is a synchronous, in-process class -- its only substrate
 * dependency is `EventLog` (Track 2's `DoReviewLog`, backed by THIS DO's own
 * `state.storage.sql`). Track 4's ported suites construct both directly
 * inside this DO's own execution context via `cloudflare:test`'s
 * `runInDurableObject(stub, (instance, state) => ...)` -- never over RPC.
 * An RPC boundary would force `DoReviewLog`'s methods to become async (RPC
 * calls always are), which would then force `ReviewService`'s entire public
 * API to become async too, exactly the ripple Track 3 already ruled out for
 * the seal. Real RPC methods (mirroring `ReviewService`'s own command
 * surface) are for PORT-2/3/4, once there's an actual boundary to cross.
 *
 * Live-verified against real production infrastructure (not just
 * vitest-pool-workers' local workerd simulator) via a temporary probe RPC,
 * since removed: DO SQLite triggers, `storage.transactionSync`, and
 * `node:crypto` Ed25519 signing/verification all behave identically on
 * deployed Cloudflare -- a full open->revise->approve->check->land sequence
 * verified with a clean seal chain, a clean audit, resolvable provenance,
 * and a blocked UPDATE against `review_log`.
 */
import { DurableObject } from "cloudflare:workers";

export class ReviewCore extends DurableObject {}
