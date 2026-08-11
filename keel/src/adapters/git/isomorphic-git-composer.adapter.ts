/**
 * PLAYBOOK-KEEL-SCR-PORT-2, Track 2: `GitComposer` re-expressed against
 * isomorphic-git's public surface, writing real commits onto the
 * Workspace's own git repo (the SAME `createGit` every run already uses).
 *
 * Atomicity (INV-6, this increment's slice of it -- the FULL fenced land
 * against an external base is PORT-3): SCR's own composer builds every
 * layer's commit on a DETACHED HEAD (checked out at `baseSha`, never
 * touching the target branch), and only at the very end moves the branch
 * ref -- ONE atomic call. If any commit in the loop throws, the branch was
 * NEVER TOUCHED, so there is nothing to "roll back": it is exactly where
 * it started. This port keeps that exact shape.
 *
 * Two confirmed findings on KEEL's actual git surface, both disclosed:
 *
 * 1. `@cloudflare/shell`'s `createGit()` is a CURATED subset of
 *    isomorphic-git (confirmed by reading its own `.d.ts`:
 *    clone/status/add/rm/commit/log/branch/checkout/fetch/pull/push/diff/
 *    init/remote) -- its own `commit()` wrapper does not expose
 *    isomorphic-git's `noUpdateBranch`/`ref` options, and its own
 *    `branch()` wrapper only ever creates a NEW branch at current HEAD, no
 *    `object`/`force` to move an EXISTING one. Both options exist on
 *    isomorphic-git's OWN public, documented, exported `commit()`/
 *    `branch()` functions -- just not passed through this particular
 *    curated wrapper. This port uses `@cloudflare/shell`'s wrapper for the
 *    routine per-layer work (checkout/add/commit, identical to what
 *    `WorkspaceGitConnector` already does every run) and reaches
 *    isomorphic-git's own `branch()` DIRECTLY, once, for the one call that
 *    needs `object`+`force`+`checkout` together -- still the public door
 *    (OD-PORT-2), just isomorphic-git's own wider surface rather than the
 *    curated slice.
 * 2. Doing so needs an isomorphic-git-compatible `fs`. `@cloudflare/shell`
 *    builds one internally (`createGitFs`, wrapping `WorkspaceFileSystem`
 *    into the `{promises:{...}}` shape isomorphic-git expects) but does
 *    NOT export it. `isomorphicGitFs` (`isomorphic-git-fs.adapter.ts`,
 *    shared with PORT-3's `GitTargetProbe`) is a small, disclosed
 *    reimplementation of that same adapter, built from the SAME
 *    `WorkspaceFileSystem` (`@cloudflare/shell`'s own public export) this
 *    file already needs for `parseFile`/`renderFile` reads. It already
 *    caught one real bug live: isomorphic-git's `stat`/`lstat` need
 *    `.isFile()`/`.isDirectory()` METHODS, not KEEL's plain
 *    `{type,size,mtime,mode}` -- see that file's own header.
 */
import type { Workspace } from "@cloudflare/shell";
import { WorkspaceFileSystem } from "@cloudflare/shell";
import { createGit } from "@cloudflare/shell/git";
import { branch as isomorphicGitBranch } from "isomorphic-git";
import { byPath, parseFile, renderFile, type ComposeLayer, type ComposeResult, type Composer } from "../../scr/vcs";
import { isomorphicGitFs } from "./isomorphic-git-fs.adapter";

/** One real commit per Change, onto the Workspace's own git repo. */
export class IsomorphicGitComposer implements Composer {
  #git: ReturnType<typeof createGit>;
  #rawFs: ReturnType<typeof isomorphicGitFs>;
  #dir: string;
  #ref: string;

  constructor(private readonly workspace: Workspace, dir = "/", ref = "main") {
    this.#git = createGit(new WorkspaceFileSystem(workspace), dir);
    this.#rawFs = isomorphicGitFs(new WorkspaceFileSystem(workspace));
    this.#dir = dir;
    this.#ref = ref;
  }

  async compose(baseSha: string, layers: ComposeLayer[]): Promise<ComposeResult> {
    // Detach onto the base -- every commit below lands here, never on
    // `this.#ref`, until the single atomic move at the end.
    await this.#git.checkout({ ref: baseSha, force: true });

    const shas: string[] = [];
    for (const layer of layers) {
      for (const [path, sections] of byPath(layer.hunks)) {
        const existing = await this.workspace.readFile(path);
        const current = existing !== null ? parseFile(existing) : new Map<string, string>();
        for (const [anchor, content] of sections) current.set(anchor, content);
        await this.workspace.writeFile(path, renderFile(current));
        await this.#git.add({ filepath: path });
      }
      const { oid } = await this.#git.commit({
        message: `${layer.title}\n\nChange-Id: ${layer.changeId}`,
        author: { name: layer.authorId, email: `${layer.authorId}@example.com` },
      });
      shas.push(oid);
    }

    const newTargetSha = shas.at(-1) ?? baseSha;
    // The one atomic ref move -- isomorphic-git's own `branch()` (public,
    // documented), not @cloudflare/shell's curated wrapper (which cannot
    // force-move an existing branch to an explicit target).
    await isomorphicGitBranch({
      fs: this.#rawFs,
      dir: this.#dir,
      ref: this.#ref,
      object: newTargetSha,
      force: true,
      checkout: true,
    });

    return { shas, newTargetSha };
  }
}
