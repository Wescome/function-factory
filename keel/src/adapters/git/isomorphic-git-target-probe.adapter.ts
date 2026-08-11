/**
 * PLAYBOOK-KEEL-SCR-PORT-3, Track 2 (INV-11 LAND-IS-FENCED): `GitTargetProbe`
 * re-expressed against isomorphic-git's public surface. SCR's own
 * `GitTargetProbe` (git.ts) was deliberately NOT ported in PORT-1/2 --
 * "external" was out of scope until now. This is the FIRST real
 * implementation of the `TargetProbe` port (PORT-1 shipped only the no-git
 * `StaticTarget`/`ScriptedTarget`).
 *
 * INV-11's own fence logic lives ENTIRELY inside `ReviewService.land()`
 * (and `observeTarget()`) already, via the `TargetProbe` port -- this
 * class only has to answer "where is the external ref right now, and what
 * moved since `sinceSha`", exactly the same contract `StaticTarget`/
 * `ScriptedTarget` already satisfy. No new orchestration wrapper needed.
 *
 * Reuses `isomorphic-git-fs.adapter.ts`'s shared `fs` (Track 1/2's own
 * finding: `@cloudflare/shell`'s `createGit()` doesn't expose the raw
 * `listFiles`/`readBlob`/`resolveRef` this needs to diff two arbitrary
 * commits without a real `git diff <sha> <sha>` -- those are isomorphic-git's
 * own public, documented, exported functions, reached directly, same
 * public-door discipline as PORT-2's atomic `branch()` move).
 */
import type { Workspace } from "@cloudflare/shell";
import { WorkspaceFileSystem } from "@cloudflare/shell";
import { createGit } from "@cloudflare/shell/git";
import { listFiles, readBlob, resolveRef } from "isomorphic-git";
import { parseFile } from "../../scr/vcs";
import type { Hunk } from "../../scr/events";
import type { TargetObservation, TargetProbe } from "../../scr/target";
import { isomorphicGitFs } from "./isomorphic-git-fs.adapter";

export interface GitTargetProbeOptions {
  readonly dir?: string;
  readonly remote?: string;
  readonly branch?: string;
  readonly token?: string;
}

export class GitTargetProbe implements TargetProbe {
  #git: ReturnType<typeof createGit>;
  #rawFs: ReturnType<typeof isomorphicGitFs>;
  #dir: string;
  #remote: string;
  #branch: string;
  #token?: string;

  constructor(workspace: Workspace, opts: GitTargetProbeOptions = {}) {
    const dir = opts.dir ?? "/";
    this.#git = createGit(new WorkspaceFileSystem(workspace), dir);
    this.#rawFs = isomorphicGitFs(new WorkspaceFileSystem(workspace));
    this.#dir = dir;
    this.#remote = opts.remote ?? "origin";
    this.#branch = opts.branch ?? "main";
    this.#token = opts.token;
  }

  async observe(sinceSha: string): Promise<TargetObservation> {
    await this.#git.fetch({ remote: this.#remote, ref: this.#branch, token: this.#token });
    const sha = await resolveRef({ fs: this.#rawFs, dir: this.#dir, ref: `refs/remotes/${this.#remote}/${this.#branch}` });
    if (sha === sinceSha) return { sha: sinceSha, incomingHunks: [] };

    // Every path present at EITHER commit -- correct by construction,
    // never relying on a `diff --name-only`-equivalent isomorphic-git
    // doesn't expose through @cloudflare/shell's curated wrapper.
    const beforeFiles = await listFiles({ fs: this.#rawFs, dir: this.#dir, ref: sinceSha }).catch(() => [] as string[]);
    const afterFiles = await listFiles({ fs: this.#rawFs, dir: this.#dir, ref: sha });
    const allPaths = new Set([...beforeFiles, ...afterFiles]);

    const incomingHunks: Hunk[] = [];
    for (const path of allPaths) {
      const before = await this.#readFileAt(sinceSha, path);
      const after = await this.#readFileAt(sha, path);
      const beforeMap = before !== null ? parseFile(before) : new Map<string, string>();
      const afterMap = after !== null ? parseFile(after) : new Map<string, string>();
      for (const [anchor, content] of afterMap) {
        if (beforeMap.get(anchor) !== content) incomingHunks.push({ path, anchor, content });
      }
    }
    return { sha, incomingHunks };
  }

  /** `git show <oid>:<path>` equivalent -- absent at that commit reads as
   *  `null`, never a throw (the SAME "absent, not an error" contract
   *  `Workspace.readFile` already uses elsewhere in this port). */
  async #readFileAt(oid: string, filepath: string): Promise<string | null> {
    try {
      const { blob } = await readBlob({ fs: this.#rawFs, dir: this.#dir, oid, filepath });
      return new TextDecoder().decode(blob);
    } catch {
      return null;
    }
  }
}

/** Clone (first time) or fetch the current external base into the
 *  Workspace's own repo, returning the current tip SHA -- the base
 *  fingerprint `openSeries`/`openExternalSeries` records. Track 1's own
 *  "fetch the external base" step. */
export async function fetchExternalBase(
  workspace: Workspace,
  opts: { url: string; branch?: string; token?: string; dir?: string },
): Promise<string> {
  const dir = opts.dir ?? "/";
  const git = createGit(new WorkspaceFileSystem(workspace), dir);
  await git.clone({ url: opts.url, branch: opts.branch ?? "main", singleBranch: true, token: opts.token });
  const [head] = await git.log({ depth: 1 });
  if (!head) throw new Error(`fetchExternalBase: clone of ${opts.url} produced no commits`);
  return head.oid;
}
