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
 *
 * PLAYBOOK-KEEL-SCR-PORT-2 live-verified too, via a second temporary probe,
 * since removed: a real clean merge (disjoint-anchor carry-forward), a real
 * conflict (same-anchor collision -> CONFLICTED), and a real compose (a
 * genuine commit with the correct parent and Change-Id trailer) all
 * confirmed against production. One real substrate finding along the way,
 * caught and fixed BEFORE this: isomorphic-git's own `stat`/`lstat` expect
 * a Node `fs.Stats`-shaped object with `.isFile()`/`.isDirectory()` METHODS,
 * not KEEL's plain `{type,size,mtime,mode}` -- `isomorphic-git-composer.
 * adapter.ts`'s own `GitStat` wrapper (mirroring `@cloudflare/shell`'s own
 * unexported one) fixes it; a first pass of that probe without the fix
 * threw `dotgitStat.isDirectory is not a function` inside isomorphic-git's
 * `discoverGitdir`, the same failure Track 3's suite caught first, locally.
 */
import { DurableObject } from "cloudflare:workers";

export class ReviewCore extends DurableObject {}
