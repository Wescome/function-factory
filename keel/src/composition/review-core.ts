/**
 * PLAYBOOK-KEEL-SCR-PORT-1, Track 2 (OD-PORT-3): the review log's own,
 * distinct Durable Object -- deliberately NOT folded into `Orchestrator`'s
 * DO.
 *
 * PLAYBOOK-KEEL-SCR-PORT-3: this is where ReviewCore graduates from "no RPC
 * surface yet" (PORT-1/2's own words) to a real one -- proving the
 * serialization guard against interleaving review-log ops needs genuine
 * concurrent RPC calls hitting the SAME DO instance mid-`land()`, which
 * `runInDurableObject` (one synchronous JS turn) cannot produce.
 *
 * PLAYBOOK-KEEL-SCR-PORT-3_5: PORT-3's own live-infra probe found the log
 * could assert `LANDED` with nothing externally shipped (a crash between
 * the domain decision and the real push), and that `targetSha` could get
 * stamped with a pushed feature-branch tip, false-refusing the NEXT land.
 * Both close here. `land()` now only AUTHORISES (`svc.land()`, sealed
 * `LandAuthorised`) then PROPAGATES resumably (`#propagate`, sealed
 * `Pushed`/`PrOpened`, each written only once its real external step
 * confirms) -- SCR's own `PARTIALLY-PROPAGATED`, designed, never built
 * until now. `resumeLand()` is the recovery path: idempotent, consults
 * external reality (is the branch already there? is the PR already open?)
 * before acting, so a crash between an external step and its status-write
 * can never double-act on resume.
 *
 * Two authorities, two fences, per this playbook's own framing:
 *   DO = review log (this class's own SQLite, INV-8/INV-12) AND the git
 *        working repo (`@cloudflare/computer`'s Workspace, PLAYBOOK-KEEL-
 *        COMPUTER-SWAP-001 -- fs-only, ~10 GB shared with the DO's own
 *        SQLite storage; KEEL's working trees are MB-scale, so this is
 *        headroom, not a risk. Confirmed against computer's real, published
 *        API, not assumed: its R2 integration is READ-ONLY MOUNTS only
 *        (writes reject EROFS), so the R2-backed spillover PORT-3 first
 *        wired via `@cloudflare/shell` never carried forward -- there was
 *        nothing to carry, since KEEL never approached even shell's own
 *        ~1.5 MB inline cap in any real land this session.)
 *   external = code + land (the real GitHub repo, INV-11 -- Track 2)
 *
 * `land_state.in_progress` mirrors C1's own `derive_state.in_progress`
 * shape exactly (Orchestrator, `derive()`): every review-log-WRITING RPC
 * method checks it at entry and refuses (fail-closed, INV-8-consistent --
 * never a silent corruption) while a land is in flight; `land()`/
 * `resumeLand()` set/clear it around their own await-laden bodies. NOT
 * `blockConcurrencyWhile` -- KEEL's DOs already proved they process
 * concurrent inbound RPCs (the C1 race, a push arriving mid-`derive()`),
 * so the guard is a flag, not a platform primitive. `resumeLand()`
 * deliberately does NOT check the guard at entry (unlike every other
 * method here) -- a stuck-true flag from a genuine crash is exactly the
 * state a resume exists to recover from; it still sets/clears the SAME
 * flag around its own run, so it is not itself unguarded against new
 * interleaving writes.
 */
import { DurableObject } from "cloudflare:workers";
import { Workspace } from "@cloudflare/computer";
import { push as gitPush } from "isomorphic-git";
import http from "isomorphic-git/http/web";
import { computerGitFs } from "../adapters/git/computer-git-fs.adapter";
import { DoReviewLog } from "../adapters/persistence/scr-review-log-do.adapter";
import { ReviewService } from "../scr/service";
import { InvariantViolation, type Hunk, type Decision, type CheckKind, type CheckOutcome } from "../scr/events";
import { AnchorRebaser, type Rebaser } from "../scr/rebase";
import { replaySeam } from "../scr/seam-replay";
import type { Composer } from "../scr/vcs";
import type { TargetProbe } from "../scr/target";
import type { LandStatus } from "../scr/model";
import { IsomorphicGitRebaser } from "../adapters/git/isomorphic-git-rebaser.adapter";
import { IsomorphicGitComposer } from "../adapters/git/isomorphic-git-composer.adapter";
import { GitTargetProbe, fetchExternalBase } from "../adapters/git/isomorphic-git-target-probe.adapter";
import { GitHubRestPrOpener, type PrOpener } from "../adapters/github/github-pr.adapter";

export interface ReviewCoreEnv {
  /** PLAYBOOK-KEEL-SCR-PORT-3, Track 1: previously wired as `@cloudflare/
   *  shell`'s Workspace's large-object R2 spillover. PLAYBOOK-KEEL-
   *  COMPUTER-SWAP-001: no longer wired into the Workspace at all --
   *  `@cloudflare/computer`'s Workspace has no equivalent write-capable
   *  R2 backing (confirmed against its real API: R2 there is read-only
   *  mounts only). Left declared, unused, as a disclosed judgment call --
   *  removing a deployed binding wasn't asked for, and it stays available
   *  for a possible future read-only mount pre-seed. */
  WORKSPACE_FILES?: R2Bucket;
  /** Shared with Orchestrator's own `WorkspaceGitConnector` (the SAME
   *  secret, one token, scoped to push + open a PR on the disposable
   *  external repo). */
  GIT_PUSH_TOKEN?: string;
  [k: string]: unknown;
}

function parseGitHubUrl(url: string): { owner: string; repo: string } {
  const m = /github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?\/?$/.exec(url);
  if (!m) throw new Error(`not a recognizable GitHub URL: ${url}`);
  return { owner: m[1]!, repo: m[2]! };
}

interface LandConfigRow {
  repo_url: string;
  owner: string;
  repo_name: string;
  target_branch: string;
  feature_branch: string;
  remote: string;
  [key: string]: string;
}

export interface LandResult {
  readonly landEventId: string;
  readonly landedShas: readonly string[];
  readonly status: LandStatus;
  readonly pr?: { readonly number: number; readonly htmlUrl: string };
}

export class ReviewCore extends DurableObject<ReviewCoreEnv> {
  private ensureSchema() {
    // PLAYBOOK-KEEL-SCR-PORT-3: the SAME shape as Orchestrator's own
    // `derive_state` (C1) -- one row, a flag, nothing else.
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS land_state (id INTEGER PRIMARY KEY, in_progress INTEGER NOT NULL DEFAULT 0)`);
    // One row per series that was opened against a REAL external repo
    // (`openExternalSeries`) -- absent for a series opened any other way,
    // which is how `land()` tells "two-tier, real push + PR" apart from
    // "local compose only" (byte-identical to PORT-1/2's own behavior).
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS land_config (
        series_id TEXT PRIMARY KEY,
        repo_url TEXT NOT NULL,
        owner TEXT NOT NULL,
        repo_name TEXT NOT NULL,
        target_branch TEXT NOT NULL,
        feature_branch TEXT NOT NULL,
        remote TEXT NOT NULL
      )
    `);
  }

  private isLandInProgress(): boolean {
    const rows = this.ctx.storage.sql.exec<{ in_progress: number }>(`SELECT in_progress FROM land_state WHERE id = 1`).toArray();
    return rows[0]?.in_progress === 1;
  }

  private setLandInProgress(v: boolean): void {
    this.ctx.storage.sql.exec(`INSERT OR REPLACE INTO land_state (id, in_progress) VALUES (1, ?)`, v ? 1 : 0);
  }

  /** Every review-log-WRITING RPC method calls this first. Fail-closed:
   *  refuses rather than risk a write racing a land's own async gap. */
  private guardAgainstLand(): void {
    this.ensureSchema();
    if (this.isLandInProgress()) {
      throw new InvariantViolation("INV-6", "a land is in progress on this series -- review-log writes are refused until it completes");
    }
  }

  private log(): DoReviewLog {
    this.ensureSchema();
    return new DoReviewLog(this.ctx.storage);
  }

  private reviewServiceFor(overrides?: { rebaser?: Rebaser; composer?: Composer; target?: TargetProbe }): ReviewService {
    return new ReviewService(this.log(), overrides);
  }

  /** PLAYBOOK-KEEL-COMPUTER-SWAP-001: `@cloudflare/computer`'s Workspace,
   *  fs-only (no execution backend -- Computer's exec surfaces are unused
   *  here). `storage: this.ctx.storage` is computer's ENTIRE constructor
   *  requirement for this path (confirmed against its real `WorkspaceOptions`
   *  type -- no `{sql,r2,name}` shape to map; that was `@cloudflare/shell`'s
   *  own, different API). The cast below is type-system friction only:
   *  `@cloudflare/workers-types`'s `SqlStorage.exec<T>` and computer's own
   *  `SQLStorageLike` each declare a slightly different generic bound over
   *  the SAME real runtime object -- `this.ctx.storage` genuinely has
   *  `.sql`/`.transaction`/`.transactionSync`, computer's own requirement. */
  private workspace(): Workspace {
    return new Workspace({ storage: this.ctx.storage as unknown as ConstructorParameters<typeof Workspace>[0]["storage"] });
  }

  private landConfigFor(seriesId: string): LandConfigRow | undefined {
    this.ensureSchema();
    const rows = this.ctx.storage.sql.exec<LandConfigRow>(
      `SELECT repo_url, owner, repo_name, target_branch, feature_branch, remote FROM land_config WHERE series_id = ?`,
      seriesId,
    ).toArray();
    return rows[0];
  }

  /** PLAYBOOK-KEEL-SCR-PORT-3_5, Track 2: DO-qualified, so two DOs
   *  targeting the same external repo never collide on the same branch
   *  name -- a real collision this playbook's own live probe hit, twice,
   *  from spinning up separate DO instances against the same scratch
   *  repo during testing. `this.ctx.id` is unique per DO instance. */
  private branchFor(seriesId: string): string {
    return `keel-land/${this.ctx.id.toString().slice(0, 16)}/${seriesId}`;
  }

  /** Real git adapters for a series opened against external infra;
   *  falls back to PORT-1/2's own defaults (AnchorRebaser/
   *  SimulatedComposer/StaticTarget, via `ReviewService`'s own
   *  constructor defaults) when no `land_config` row exists -- byte-
   *  identical local-only behavior, unchanged. */
  private gitOverridesFor(seriesId: string): { rebaser?: Rebaser; composer?: Composer; target?: TargetProbe } {
    const cfg = this.landConfigFor(seriesId);
    if (!cfg) return {};
    const ws = this.workspace();
    return {
      rebaser: new IsomorphicGitRebaser(),
      // PLAYBOOK-KEEL-SCR-PORT-3_5: `targetAdvanced: false` -- this composer
      // builds onto the feature branch, never `main`. The false-drift fix
      // (Model.apply, `targetAdvanced`-gated) depends on this being honest.
      composer: new IsomorphicGitComposer(ws, "/", cfg.feature_branch, false),
      target: new GitTargetProbe(ws, { branch: cfg.target_branch, remote: cfg.remote, token: this.env.GIT_PUSH_TOKEN }),
    };
  }

  // ——— series & changes (no git touched -- defaults are fine, guard applies) ———

  async openSeries(actorId: string, targetRef: string, targetSha: string): Promise<string> {
    this.guardAgainstLand();
    return this.reviewServiceFor().openSeries(actorId, targetRef, targetSha);
  }

  /** PLAYBOOK-KEEL-SCR-PORT-3, Track 1: fetch the external base into the
   *  R2-owned working repo, record its fingerprint, open the series
   *  against it, and remember the repo/branch config so `land()` knows
   *  this series lands for real. */
  async openExternalSeries(actorId: string, repoUrl: string, branch = "main"): Promise<{ seriesId: string; baseSha: string }> {
    this.guardAgainstLand();
    const { owner, repo } = parseGitHubUrl(repoUrl);
    const ws = this.workspace();
    const baseSha = await fetchExternalBase(ws, { url: repoUrl, branch, token: this.env.GIT_PUSH_TOKEN });
    const seriesId = await this.reviewServiceFor().openSeries(actorId, `refs/heads/${branch}`, baseSha);
    const featureBranch = this.branchFor(seriesId);
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO land_config (series_id, repo_url, owner, repo_name, target_branch, feature_branch, remote) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      seriesId, repoUrl, owner, repo, branch, featureBranch, "origin",
    );
    return { seriesId, baseSha };
  }

  /**
   * PLAYBOOK-KEEL-SCR-PORT-4, Track 1: `parents` threaded through to
   * `ReviewService.openChange`'s own long-existing 6th parameter
   * (service.ts:132). Additive and optional — every pre-PORT-4 caller
   * passes nothing and keeps SCR's own default ("stack on the current
   * tips", service.ts:138), byte-identical.
   *
   * A caller that HAS a graph must pass it explicitly, including `[]` for
   * a root. Omitting it does not mean "no parents"; it means "guess", and
   * the guess is a linear spine — which for a C2-derived batch would be a
   * second graph arriving by omission.
   */
  async openChange(
    actorId: string,
    seriesId: string,
    title: string,
    requiredReviewers: string[] = [],
    parents?: string[],
  ): Promise<string> {
    this.guardAgainstLand();
    return this.reviewServiceFor().openChange(actorId, seriesId, title, requiredReviewers, undefined, parents);
  }

  /**
   * PLAYBOOK-KEEL-SCR-PORT-4, Track 1: `reason` was hardcoded to
   * `ReviewService`'s own default here, which meant INV-14
   * RESOLUTION-NEVER-CARRIES (service.ts:870-875 — `resolving = reason
   * === 'conflict-resolution'`, suppressing carry-forward) existed in the
   * domain but was UNREACHABLE through the RPC surface. Nothing else
   * changes: the default is the same string the domain already defaulted
   * to, so every existing caller is byte-identical.
   */
  async appendRevision(actorId: string, changeId: string, hunks: Hunk[], reason = "author-edit"): Promise<number> {
    this.guardAgainstLand();
    return this.reviewServiceFor().appendRevision(actorId, changeId, hunks, reason);
  }

  async recordVerdict(reviewerId: string, changeId: string, decision: Decision): Promise<string> {
    this.guardAgainstLand();
    return this.reviewServiceFor().recordVerdict(reviewerId, changeId, decision);
  }

  async recordCheck(actorId: string, changeId: string, kind: CheckKind, outcome: CheckOutcome): Promise<string> {
    this.guardAgainstLand();
    return this.reviewServiceFor().recordCheck(actorId, changeId, kind, outcome);
  }

  /** Read-only: never guarded -- observing the target ref outside a land
   *  (e.g. a UI polling for upstream drift) is safe at any time; it's
   *  `land()`'s OWN internal observe (INV-11) that matters for fencing a
   *  push, not this standalone call. */
  async observeTarget(actorId: string, seriesId: string): Promise<boolean> {
    this.ensureSchema();
    return this.reviewServiceFor(this.gitOverridesFor(seriesId)).observeTarget(actorId, seriesId);
  }

  // ——— seam resolution (PLAYBOOK-KEEL-SCR-PORT-4, Track 2) ———

  /** The rebaser this series' own `land()` would use — the real
   *  `IsomorphicGitRebaser` for a series opened against external infra,
   *  SCR's own `AnchorRebaser` otherwise. Resolving a seam with a
   *  DIFFERENT conflict oracle than the one that will gate the land would
   *  be its own quiet lie: clean here, refused there. */
  private rebaserFor(seriesId: string): Rebaser {
    return this.gitOverridesFor(seriesId).rebaser ?? new AnchorRebaser();
  }

  /**
   * PLAYBOOK-KEEL-SCR-PORT-4, Track 2: turn a detected file overlap into
   * either a resolved Change or a named INV-9 conflict.
   *
   * The resolution is a REAL MERGE POINT in the one graph: it is opened
   * with BOTH overlapping slices as `parents`, so nothing about the
   * resolution sits outside the graph the series already has. And its
   * content arrives as a `"conflict-resolution"` revision — the trigger
   * for INV-14 RESOLUTION-NEVER-CARRIES (service.ts:870-875), which
   * PORT-4 Track 1 made reachable through this RPC surface for the first
   * time. INV-14 is belt-and-braces here rather than the load-bearing
   * guarantee: a freshly-opened Change has no live verdicts to inherit in
   * the first place, so the resolution is unreviewed BY CONSTRUCTION.
   * INV-14 is what protects any future path that applies a resolution as
   * a revision to an EXISTING Change.
   *
   * Conflict RETURNS rather than throws. INV-9 is "conflict is a state",
   * and a state is a value; it also means no caller — now or later — has
   * to reach for `.rejects` on a workerd RPC proxy to observe it.
   *
   * Deliberately records NO verdict (step 7). The fresh Approver verdict
   * is a human's to give: `requiredReviewers` is non-empty (inherited
   * from the slices being merged unless the caller names its own), and an
   * empty verdict set against a non-empty required list is exactly what
   * `land()` refuses (service.ts:699-706). Fail-closed by construction.
   *
   * `opts.checkOutcome` is OD-PORT4-1's auto check re-run, in its honest
   * form. `ReviewCore` cannot itself re-run KEEL's VERIFY — that oracle
   * lives on `Orchestrator`, a different DO and a different authority —
   * so it records the outcome the caller ACTUALLY OBSERVED. The caller
   * gets the content to observe from `previewSeam` (below), which
   * produces the same merge this method will, through the same rebaser,
   * without writing anything. Absent, it records no check at all, and
   * `land()` then refuses the resolution on INV-4 ("no integrated check
   * for (rev, base)"). That is stronger than recording a `fail` and much
   * stronger than assuming a `pass`: the merged content is content
   * nothing has verified, and the log says so by staying silent rather
   * than by claiming a result nobody produced.
   */
  /**
   * PLAYBOOK-KEEL-SCR-PORT-4 (OD-PORT4-1): the merged content, BEFORE
   * anything is written to the log.
   *
   * OD-PORT4-1 requires that "the check (VERIFY) re-runs automatically on
   * the merged content." An oracle cannot judge content it has not been
   * shown, and the oracle that would judge it does not live here — it
   * lives on `Orchestrator`, a different DO and a different authority. So
   * the merge is split in two: this method PRODUCES the merged content,
   * the caller runs its own VERIFY over it, and `resolveSeam` then
   * finalizes with the outcome that run ACTUALLY produced. Neither half
   * ever has to assume the other's answer.
   *
   * Uses `rebaserFor(seriesId)` — the SAME conflict oracle `resolveSeam`
   * and `land()` use — and `replaySeam` is pure over (ordered, rebaser),
   * so the preview and the finalize provably cannot disagree about
   * either the verdict or the resolved content.
   *
   * Emits nothing and opens nothing: a conflict here leaves the log
   * exactly as it found it, and a clean preview leaves it equally
   * untouched. It is still `guardAgainstLand()`-gated rather than merely
   * `ensureSchema()`-gated, unlike the genuinely standalone read
   * `observeTarget`: this answer is the INPUT to a write, so serving a
   * merge out of a log that is mid-land would hand a caller content it is
   * about to act on from a state the land is still moving.
   */
  async previewSeam(
    seriesId: string,
    ordered: { changeId: string; hunks: Hunk[] }[],
  ): Promise<
    | { ok: true; resolved: Hunk[] }
    | { ok: false; invariant: "INV-9"; at: string; changeId: string }
  > {
    this.guardAgainstLand();
    const replay = replaySeam(ordered, this.rebaserFor(seriesId));
    return replay.ok
      ? { ok: true, resolved: [...replay.resolved] }
      : {
          ok: false,
          invariant: "INV-9",
          at: `${replay.at.path}:${replay.at.anchor}`,
          changeId: replay.changeId,
        };
  }

  async resolveSeam(
    actorId: string,
    seriesId: string,
    ordered: { changeId: string; hunks: Hunk[] }[],
    opts: { requiredReviewers?: string[]; checkOutcome?: CheckOutcome } = {},
  ): Promise<
    | { ok: true; resolvedChangeId: string }
    | { ok: false; invariant: "INV-9"; at: string; changeId: string }
  > {
    this.guardAgainstLand();

    const replay = replaySeam(ordered, this.rebaserFor(seriesId));
    if (!replay.ok) {
      return {
        ok: false,
        invariant: "INV-9",
        at: `${replay.at.path}:${replay.at.anchor}`,
        changeId: replay.changeId,
      };
    }

    const svc = this.reviewServiceFor();
    const m = svc.model;
    const parents = ordered.map((o) => o.changeId);
    // Inherit the union of the merged slices' own required reviewers when
    // the caller names none: whoever had to approve either side of a
    // conflict must approve what the conflict resolved into.
    const requiredReviewers =
      opts.requiredReviewers ??
      [...new Set(parents.flatMap((id) => m.changes.get(id)?.requiredReviewers ?? []))];
    const files = [...new Set(replay.resolved.map((h) => h.path))].sort().join(", ");

    const resolvedChangeId = await this.openChange(
      actorId,
      seriesId,
      `seam resolution: ${files}`,
      requiredReviewers,
      parents,
    );
    await this.appendRevision(actorId, resolvedChangeId, [...replay.resolved], "conflict-resolution");
    if (opts.checkOutcome) {
      await this.recordCheck(actorId, resolvedChangeId, "integrated", opts.checkOutcome);
    }
    return { ok: true, resolvedChangeId };
  }

  // ——— landing ———

  /**
   * PLAYBOOK-KEEL-SCR-PORT-3_5, Track 1/2. `svc.land()` does the fenced
   * local compose (INV-11 re-observe, INV-5/6/9 preconditions) and seals
   * ONLY the atomic domain decision (`LandAuthorised`) -- it no longer
   * pushes or opens a PR itself (PORT-3's own finding: that let the log
   * assert LANDED with nothing shipped on a partial failure). `#propagate`
   * does the resumable, idempotent external work, sealing `Pushed`/
   * `PrOpened` only as each genuinely confirms. If propagation throws, the
   * error carries `landEventId` so the caller can `resumeLand` with it --
   * the log itself already shows exactly how far it got.
   */
  async land(actorId: string, seriesId: string, changeIds: string[]): Promise<LandResult> {
    this.guardAgainstLand();
    this.setLandInProgress(true);
    let landEventId: string | undefined;
    try {
      const svc = this.reviewServiceFor(this.gitOverridesFor(seriesId));
      landEventId = await svc.land(actorId, seriesId, changeIds);
      return await this.propagate(actorId, seriesId, landEventId);
    } catch (err) {
      if (landEventId && err instanceof Error) {
        (err as Error & { landEventId?: string }).landEventId = landEventId;
      }
      throw err;
    } finally {
      this.setLandInProgress(false);
    }
  }

  /**
   * PLAYBOOK-KEEL-SCR-PORT-3_5, Track 1/2: resume an interrupted land.
   * `landEventId` is read from the log (via `land()`'s own thrown error,
   * or `snapshot()`'s `lands`) -- this method trusts it and continues
   * from whatever `LandRecord.status` is currently true, idempotently.
   *
   * Deliberately skips `guardAgainstLand()`'s precheck: a stuck-true
   * `land_state.in_progress` from a genuine crash is exactly the
   * condition a resume must be able to run under. It still claims the
   * SAME flag for the duration of its own run (fencing new interleaving
   * writes) and clears it in `finally`, same as `land()`.
   */
  async resumeLand(actorId: string, seriesId: string, landEventId: string): Promise<LandResult> {
    this.ensureSchema();
    const probe = this.reviewServiceFor();
    const rec = probe.model.landRecord(landEventId);
    if (!rec || rec.seriesId !== seriesId) {
      throw new Error(`resumeLand: no land ${landEventId} recorded on series ${seriesId}`);
    }
    this.setLandInProgress(true);
    try {
      return await this.propagate(actorId, seriesId, landEventId);
    } finally {
      this.setLandInProgress(false);
    }
  }

  /**
   * PLAYBOOK-KEEL-SCR-PORT-3_5, Track 1/2: the resumable propagation
   * sequence, shared by `land()` and `resumeLand()`. Each step consults
   * external reality BEFORE acting -- a crash can land between a real
   * step and its status-write, so "already AUTHORISED" or "already
   * PUSHED" is never assumed to mean "and so the external side needs
   * doing." No `land_config` (or no push credential): PORT-1/2's own
   * local-only behavior, unchanged -- `LandAuthorised` alone is the
   * complete, terminal fact.
   */
  private async propagate(actorId: string, seriesId: string, landEventId: string): Promise<LandResult> {
    const svc = this.reviewServiceFor();
    const cfg = this.landConfigFor(seriesId);
    const authorised = svc.model.landRecord(landEventId)!;
    if (!cfg || !this.env.GIT_PUSH_TOKEN) {
      return { landEventId, landedShas: authorised.landedShas, status: "AUTHORISED" };
    }
    const opener = new GitHubRestPrOpener(this.env.GIT_PUSH_TOKEN);

    if (authorised.status === "AUTHORISED") {
      await this.ensurePushed(svc, opener, cfg, authorised, actorId);
    }
    const pushed = svc.model.landRecord(landEventId)!;
    if (pushed.status === "PUSHED") {
      await this.ensurePrOpened(svc, opener, cfg, pushed, actorId);
    }

    const final = svc.model.landRecord(landEventId)!;
    return {
      landEventId,
      landedShas: final.landedShas,
      status: final.status,
      pr: final.pr ? { number: final.pr.number, htmlUrl: final.pr.url } : undefined,
    };
  }

  /** Idempotent: if the remote branch already sits at the composed tip
   *  (a resume after a crash that pushed but never confirmed), skip the
   *  push and just seal the confirmation -- never double-push. */
  private async ensurePushed(
    svc: ReviewService,
    opener: PrOpener,
    cfg: LandConfigRow,
    rec: { landEventId: string; newTargetSha: string },
    actorId: string,
  ): Promise<void> {
    const remoteSha = await opener.getBranchSha(cfg.owner, cfg.repo_name, cfg.feature_branch);
    if (remoteSha !== rec.newTargetSha) {
      const ws = this.workspace();
      const token = this.env.GIT_PUSH_TOKEN;
      await gitPush({
        fs: computerGitFs(ws.fs),
        http,
        dir: "/",
        remote: cfg.remote,
        ref: cfg.feature_branch,
        onAuth: token ? () => ({ username: token }) : undefined,
      });
    }
    svc.confirmPushed(actorId, rec.landEventId, rec.newTargetSha);
  }

  /** Idempotent: if a PR from this branch onto the target is already
   *  open (a resume after a crash between opening it and confirming),
   *  reuse it -- never double-open. */
  private async ensurePrOpened(
    svc: ReviewService,
    opener: PrOpener,
    cfg: LandConfigRow,
    rec: { landEventId: string; changeIds: string[] },
    actorId: string,
  ): Promise<void> {
    const existing = await opener.findExistingPr(cfg.owner, cfg.repo_name, cfg.feature_branch, cfg.target_branch);
    const model = svc.model;
    const changeTitles = rec.changeIds.map((id) => model.changes.get(id)!.title);
    const pr =
      existing ??
      (await opener.openPr({
        owner: cfg.owner,
        repo: cfg.repo_name,
        head: cfg.feature_branch,
        base: cfg.target_branch,
        title: `KEEL land: ${changeTitles.join(", ")}`,
        body: `Landed via SCR/KEEL PORT-3.5.\n\nChanges: ${rec.changeIds.join(", ")}\nLandEvent: ${rec.landEventId}`,
      }));
    svc.confirmPrOpened(actorId, rec.landEventId, pr.number, pr.htmlUrl);
  }

  // ——— reads ———

  async provenanceOf(sha: string) {
    this.ensureSchema();
    return this.reviewServiceFor().provenanceOf(sha);
  }

  /** PLAYBOOK-KEEL-SCR-PORT-4 (Track 3): the sha this Change shipped as,
   *  or `null` if it has not landed. Read off the sealed `LandAuthorised`
   *  events (`landedShas` is 1:1 with `changeIds`, OD-5 — one commit per
   *  Change), never off a repository. This is the hop a downstream needs
   *  before it can ask `provenanceOf`, and keeping it here means no
   *  caller ever has to reconstruct that correspondence itself. */
  async landedShaOf(changeId: string): Promise<string | null> {
    this.ensureSchema();
    for (const l of this.reviewServiceFor().model.lands) {
      const i = l.changeIds.indexOf(changeId);
      if (i !== -1) return l.landedShas[i] ?? null;
    }
    return null;
  }

  /** PLAYBOOK-KEEL-SCR-PORT-4: read-only, ungated (same reasoning as
   *  `provenanceOf`/`observeTarget` — observing the log never corrupts a
   *  land in flight). The verdicts currently attached to this change's
   *  HEAD revision and not stale (`Model.liveVerdicts`, model.ts:475) —
   *  which is exactly the set `land()` itself consults, so a caller can
   *  see what land will see. PORT-4 needs it to prove INV-14: a
   *  conflict-resolution revision inherits NO approval. */
  async liveVerdicts(changeId: string): Promise<readonly { verdictId: string; reviewerId: string; decision: Decision; carriedFrom?: string }[]> {
    this.ensureSchema();
    return this.reviewServiceFor().model.liveVerdicts(changeId).map((v) => ({
      verdictId: v.verdictId,
      reviewerId: v.reviewerId,
      decision: v.decision,
      carriedFrom: v.carriedFrom,
    }));
  }

  /** PLAYBOOK-KEEL-SCR-PORT-4: read-only. `Model.liveCheck` (model.ts) —
   *  a check counts only on the exact (revision, baseFingerprint) pair in
   *  force NOW, so this returning `null` after a lower layer revised IS
   *  INV-4's two-axis staleness, observable. */
  async liveCheck(changeId: string, kind: CheckKind): Promise<{ checkId: string; outcome: CheckOutcome; revisionSeq: number } | null> {
    this.ensureSchema();
    const c = this.reviewServiceFor().model.liveCheck(changeId, kind);
    return c ? { checkId: c.checkId, outcome: c.outcome, revisionSeq: c.revisionSeq } : null;
  }

  /** Read-only diagnostic -- mirrors Orchestrator's own `debugFanout()`
   *  philosophy ("diagnose from the log, not from a re-read"). `lands`
   *  now carries each land's folded propagation status (PLAYBOOK-KEEL-
   *  SCR-PORT-3_5) -- this IS the honesty guarantee surfaced to a caller:
   *  the true state is exactly what folding the sealed events produces. */
  async snapshot(seriesId: string) {
    this.ensureSchema();
    const svc = this.reviewServiceFor();
    const m = svc.model;
    const s = m.series.get(seriesId);
    return {
      series: s ?? null,
      changes: s ? s.members.map((id) => ({ id, state: m.state(id), ...m.changes.get(id) })) : [],
      // PLAYBOOK-KEEL-SCR-PORT-4: the deterministic topological order
      // (`Model.openOrder`, model.ts:401 — Kahn with an open-order
      // tiebreak) this series composes in. Surfaced because it is THE
      // single source of truth for order: PORT-4's Track 1 test asserts
      // that C2's own dependency order and this are the same sequence,
      // which is the "one graph, not two" guarantee made checkable.
      openOrder: s ? m.openOrder(seriesId) : [],
      lands: m.lands,
      landInProgress: this.isLandInProgress(),
    };
  }
}
