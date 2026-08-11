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
 * Two authorities, two fences, per this playbook's own framing:
 *   DO = review log (this class's own SQLite, INV-8/INV-12)
 *   R2 = compose/durability (the Workspace's large-object backing, Track 1)
 *   external = code + land (the real GitHub repo, INV-11 -- Track 2)
 *
 * `land_state.in_progress` mirrors C1's own `derive_state.in_progress`
 * shape exactly (Orchestrator, `derive()`): every review-log-WRITING RPC
 * method checks it at entry and refuses (fail-closed, INV-8-consistent --
 * never a silent corruption) while a land is in flight; `land()` itself
 * sets/clears it around its own await-laden body. NOT
 * `blockConcurrencyWhile` -- KEEL's DOs already proved they process
 * concurrent inbound RPCs (the C1 race, a push arriving mid-`derive()`),
 * so the guard is a flag, not a platform primitive. Two fences, two
 * concerns: this flag fences REVIEW STATE; `GitTargetProbe`
 * (`observe()`, called inside `svc.land()`) fences the EXTERNAL ref.
 */
import { DurableObject } from "cloudflare:workers";
import { Workspace } from "@cloudflare/shell";
import { createGit } from "@cloudflare/shell/git";
import { WorkspaceFileSystem } from "@cloudflare/shell";
import { DoReviewLog } from "../adapters/persistence/scr-review-log-do.adapter";
import { ReviewService } from "../scr/service";
import { InvariantViolation, type Hunk, type Decision, type CheckKind, type CheckOutcome } from "../scr/events";
import type { Rebaser } from "../scr/rebase";
import type { Composer } from "../scr/vcs";
import type { TargetProbe } from "../scr/target";
import { IsomorphicGitRebaser } from "../adapters/git/isomorphic-git-rebaser.adapter";
import { IsomorphicGitComposer } from "../adapters/git/isomorphic-git-composer.adapter";
import { GitTargetProbe, fetchExternalBase } from "../adapters/git/isomorphic-git-target-probe.adapter";
import { GitHubRestPrOpener } from "../adapters/github/github-pr.adapter";

export interface ReviewCoreEnv {
  /** PLAYBOOK-KEEL-SCR-PORT-3, Track 1 (OD-PORT-1): the R2-owned working
   *  repo -- large git objects spill here past the inline SQLite cap. */
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

export interface LandResult {
  readonly landEventId: string;
  readonly landedShas: readonly string[];
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

  private workspace(): Workspace {
    return new Workspace({ sql: this.ctx.storage.sql, r2: this.env.WORKSPACE_FILES, name: () => "review-core-land" });
  }

  private landConfigFor(seriesId: string) {
    this.ensureSchema();
    const rows = this.ctx.storage.sql.exec<{
      repo_url: string; owner: string; repo_name: string; target_branch: string; feature_branch: string; remote: string;
    }>(`SELECT repo_url, owner, repo_name, target_branch, feature_branch, remote FROM land_config WHERE series_id = ?`, seriesId).toArray();
    return rows[0];
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
      composer: new IsomorphicGitComposer(ws, "/", cfg.feature_branch),
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
    const featureBranch = `keel-land/${seriesId}`;
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO land_config (series_id, repo_url, owner, repo_name, target_branch, feature_branch, remote) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      seriesId, repoUrl, owner, repo, branch, featureBranch, "origin",
    );
    return { seriesId, baseSha };
  }

  async openChange(actorId: string, seriesId: string, title: string, requiredReviewers: string[] = []): Promise<string> {
    this.guardAgainstLand();
    return this.reviewServiceFor().openChange(actorId, seriesId, title, requiredReviewers);
  }

  async appendRevision(actorId: string, changeId: string, hunks: Hunk[]): Promise<number> {
    this.guardAgainstLand();
    return this.reviewServiceFor().appendRevision(actorId, changeId, hunks);
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

  // ——— landing ———

  /**
   * PLAYBOOK-KEEL-SCR-PORT-3, Track 2. `svc.land()` does the fenced local
   * compose (INV-11 re-observe, INV-5/6/9 preconditions, the sealed
   * LandEvent) -- unchanged from PORT-1/2. This wraps it with the TWO
   * things only a real external repo needs: pushing the composed feature
   * branch, and opening the PR. Guarded start-to-finish by
   * `land_state.in_progress` (set before `svc.land()`'s own await-laden
   * body runs, cleared in `finally`) so an `approve`/`revise` cannot
   * interleave and corrupt the landing set out from under it.
   */
  async land(actorId: string, seriesId: string, changeIds: string[]): Promise<LandResult> {
    this.guardAgainstLand();
    this.setLandInProgress(true);
    try {
      const overrides = this.gitOverridesFor(seriesId);
      const svc = this.reviewServiceFor(overrides);
      const landEventId = await svc.land(actorId, seriesId, changeIds);
      const landedShas = svc.model.lands.at(-1)?.landedShas ?? [];

      const cfg = this.landConfigFor(seriesId);
      if (!cfg || !this.env.GIT_PUSH_TOKEN) {
        // No real external repo configured (or no credential) -- PORT-1/2's
        // own local-only behavior, unchanged.
        return { landEventId, landedShas };
      }

      const ws = this.workspace();
      const git = createGit(new WorkspaceFileSystem(ws));
      await git.push({ remote: cfg.remote, ref: cfg.feature_branch, token: this.env.GIT_PUSH_TOKEN });

      const opener = new GitHubRestPrOpener(this.env.GIT_PUSH_TOKEN);
      const changeTitles = svc.model.lands.at(-1)!.changeIds.map((id) => svc.model.changes.get(id)!.title);
      const pr = await opener.openPr({
        owner: cfg.owner,
        repo: cfg.repo_name,
        head: cfg.feature_branch,
        base: cfg.target_branch,
        title: `KEEL land: ${changeTitles.join(", ")}`,
        body: `Landed via SCR/KEEL PORT-3.\n\nChanges: ${svc.model.lands.at(-1)!.changeIds.join(", ")}\nLandEvent: ${landEventId}`,
      });

      return { landEventId, landedShas, pr: { number: pr.number, htmlUrl: pr.htmlUrl } };
    } finally {
      this.setLandInProgress(false);
    }
  }

  // ——— reads ———

  async provenanceOf(sha: string) {
    this.ensureSchema();
    return this.reviewServiceFor().provenanceOf(sha);
  }

  /** Read-only diagnostic -- mirrors Orchestrator's own `debugFanout()`
   *  philosophy ("diagnose from the log, not from a re-read"). */
  async snapshot(seriesId: string) {
    this.ensureSchema();
    const svc = this.reviewServiceFor();
    const m = svc.model;
    const s = m.series.get(seriesId);
    return {
      series: s ?? null,
      changes: s ? s.members.map((id) => ({ id, state: m.state(id), ...m.changes.get(id) })) : [],
      lands: m.lands,
      landInProgress: this.isLandInProgress(),
    };
  }
}
