/**
 * PLAYBOOK-KEEL-SCR-PORT-2, Track 2: `GitComposer` re-expressed against
 * isomorphic-git's public surface, writing real commits onto the
 * Workspace's own git repo.
 *
 * Atomicity (INV-6, this increment's slice of it -- the FULL fenced land
 * against an external base is PORT-3): SCR's own composer builds every
 * layer's commit on a DETACHED HEAD (checked out at `baseSha`, never
 * touching the target branch), and only at the very end moves the branch
 * ref -- ONE atomic call. If any commit in the loop throws, the branch was
 * NEVER TOUCHED, so there is nothing to "roll back": it is exactly where
 * it started. This port keeps that exact shape.
 *
 * PLAYBOOK-KEEL-COMPUTER-SWAP-001: repointed from `@cloudflare/shell`'s
 * `createGit()` (a curated wrapper needing an UNEXPORTED internal fs
 * adapter, `isomorphic-git-fs.adapter.ts`'s own former mirror) to
 * isomorphic-git's OWN exported functions, direct, against
 * `@cloudflare/computer`'s first-class `WorkspaceFilesystem`
 * (`computer-git-fs.adapter.ts`). ONE fs adapter now, not two -- every
 * isomorphic-git call in this file (`checkout`/`add`/`commit`/`branch`)
 * goes through it; `@cloudflare/shell`'s curated wrapper (and the reach-
 * under it forced for `branch({force})`, the only thing it couldn't
 * express) is gone entirely, not just the one call that used to bypass
 * it. Composer LOGIC is unchanged -- detached-HEAD-per-layer, one atomic
 * branch move at the end -- only the fs source and which library surface
 * (isomorphic-git's own vs. shell's curated subset) performs each step.
 */
import type { Workspace } from "@cloudflare/computer";
import { checkout, add, commit, branch as isomorphicGitBranch } from "isomorphic-git";
import { byPath, parseFile, renderFile, type ComposeLayer, type ComposeResult, type Composer } from "../../scr/vcs";
import { computerGitFs } from "./computer-git-fs.adapter";

/** One real commit per Change, onto the Workspace's own git repo. */
export class IsomorphicGitComposer implements Composer {
  #fs: ReturnType<typeof computerGitFs>;
  #dir: string;
  #ref: string;
  #targetAdvanced: boolean;

  /**
   * PLAYBOOK-KEEL-SCR-PORT-3_5, Track 2 (the false-drift fix): `targetAdvanced`
   * tells the domain whether `ref` IS the real thing INV-11 fences against.
   * Defaults `true` -- every PORT-1/2 call site (and every test) builds
   * directly onto `main`, single-repo, unchanged. PORT-3's own two-tier
   * wiring (`review-core.ts`) passes `false` when `ref` is a feature branch,
   * not `main` -- this composer alone knows which ref it moved, so it alone
   * can report it honestly.
   */
  constructor(private readonly workspace: Workspace, dir = "/", ref = "main", targetAdvanced = true) {
    this.#fs = computerGitFs(workspace.fs);
    this.#dir = dir;
    this.#ref = ref;
    this.#targetAdvanced = targetAdvanced;
  }

  /** isomorphic-git's own `add`/`checkout`/`commit` take `filepath`
   *  RELATIVE to `dir` (its own convention) -- but a REAL, disclosed
   *  wrapper-gap finding from this playbook's own live run: computer's
   *  `workspace.fs` (unlike `@cloudflare/shell`'s more lenient wrapper)
   *  REQUIRES an absolute path, throwing `WorkspaceFsError: Invalid path
   *  (must be absolute)` on a bare relative one. The raw hunk paths
   *  (`byPath()`, e.g. `"shared.ts"`) need this join before any DIRECT
   *  `workspace.fs` call; isomorphic-git's OWN internal fs calls already
   *  produce absolute paths itself (it joins `dir` first), so this is
   *  needed only at the two spots in this file that touch `workspace.fs`
   *  directly, not everywhere. */
  #absPath(path: string): string {
    return this.#dir === "/" ? `/${path}` : `${this.#dir.replace(/\/$/, "")}/${path}`;
  }

  async #readFileOrNull(path: string): Promise<string | null> {
    try {
      return await this.workspace.fs.readFile(this.#absPath(path), "utf8");
    } catch {
      return null;
    }
  }

  async compose(baseSha: string, layers: ComposeLayer[]): Promise<ComposeResult> {
    // Detach onto the base -- every commit below lands here, never on
    // `this.#ref`, until the single atomic move at the end.
    await checkout({ fs: this.#fs, dir: this.#dir, ref: baseSha, force: true });

    const shas: string[] = [];
    for (const layer of layers) {
      for (const [path, sections] of byPath(layer.hunks)) {
        const existing = await this.#readFileOrNull(path);
        const current = existing !== null ? parseFile(existing) : new Map<string, string>();
        for (const [anchor, content] of sections) current.set(anchor, content);
        await this.workspace.fs.writeFile(this.#absPath(path), renderFile(current));
        await add({ fs: this.#fs, dir: this.#dir, filepath: path });
      }
      const oid = await commit({
        fs: this.#fs,
        dir: this.#dir,
        message: `${layer.title}\n\nChange-Id: ${layer.changeId}`,
        author: { name: layer.authorId, email: `${layer.authorId}@example.com` },
      });
      shas.push(oid);
    }

    const newTargetSha = shas.at(-1) ?? baseSha;
    // The one atomic ref move -- isomorphic-git's own `branch()` (public,
    // documented), now running NATIVELY against computer's `workspace.fs`,
    // no reach-under at all (the coupling PORT-2 disclosed and this
    // playbook exists to remove).
    await isomorphicGitBranch({
      fs: this.#fs,
      dir: this.#dir,
      ref: this.#ref,
      object: newTargetSha,
      force: true,
      checkout: true,
    });

    return { shas, newTargetSha, targetAdvanced: this.#targetAdvanced };
  }
}
