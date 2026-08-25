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
 * PLAYBOOK-KEEL-COMPUTER-SWAP-001: repointed from `@cloudflare/shell`'s
 * `createGit()` (fetch/clone/log) plus this file's own former mirror
 * (listFiles/readBlob/resolveRef) to isomorphic-git's OWN exported
 * functions throughout, against `@cloudflare/computer`'s first-class
 * `WorkspaceFilesystem` (`computer-git-fs.adapter.ts`). ONE fs adapter,
 * one library surface, no reach-under anywhere in this file now.
 * `isomorphic-git/http/web` supplies the fetch-based HTTP client
 * `@cloudflare/shell`'s own wrapper used internally for the SAME real
 * network fetch; a bare GitHub PAT is passed via isomorphic-git's own
 * `onAuth` callback (`{username: token}`, the documented pattern for
 * GitHub HTTPS token auth), replacing shell's curated `token` option.
 */
import type { Workspace } from "@cloudflare/computer";
import { clone, fetch as gitFetch, listFiles, log, readBlob, resolveRef } from "isomorphic-git";
import http from "isomorphic-git/http/web";
import { parseFile } from "../../scr/vcs";
import type { Hunk } from "../../scr/events";
import type { TargetObservation, TargetProbe } from "../../scr/target";
import { computerGitFs } from "./computer-git-fs.adapter";

function onAuthFor(token: string | undefined) {
  return token ? () => ({ username: token }) : undefined;
}

export interface GitTargetProbeOptions {
  readonly dir?: string;
  readonly remote?: string;
  readonly branch?: string;
  readonly token?: string;
}

export class GitTargetProbe implements TargetProbe {
  #fs: ReturnType<typeof computerGitFs>;
  #dir: string;
  #remote: string;
  #branch: string;
  #token?: string;

  constructor(workspace: Workspace, opts: GitTargetProbeOptions = {}) {
    this.#fs = computerGitFs(workspace.fs);
    this.#dir = opts.dir ?? "/";
    this.#remote = opts.remote ?? "origin";
    this.#branch = opts.branch ?? "main";
    this.#token = opts.token;
  }

  async observe(sinceSha: string): Promise<TargetObservation> {
    await gitFetch({
      fs: this.#fs,
      http,
      dir: this.#dir,
      remote: this.#remote,
      ref: this.#branch,
      singleBranch: true,
      onAuth: onAuthFor(this.#token),
    });
    const sha = await resolveRef({ fs: this.#fs, dir: this.#dir, ref: `refs/remotes/${this.#remote}/${this.#branch}` });
    if (sha === sinceSha) return { sha: sinceSha, incomingHunks: [] };

    // Every path present at EITHER commit -- correct by construction,
    // never relying on a `diff --name-only`-equivalent isomorphic-git
    // doesn't expose through @cloudflare/shell's curated wrapper.
    const beforeFiles = await listFiles({ fs: this.#fs, dir: this.#dir, ref: sinceSha }).catch(() => [] as string[]);
    const afterFiles = await listFiles({ fs: this.#fs, dir: this.#dir, ref: sha });
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
   *  `computerGitFs` already uses elsewhere in this port). */
  async #readFileAt(oid: string, filepath: string): Promise<string | null> {
    try {
      const { blob } = await readBlob({ fs: this.#fs, dir: this.#dir, oid, filepath });
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
  const fs = computerGitFs(workspace.fs);
  await clone({
    fs,
    http,
    dir,
    url: opts.url,
    ref: opts.branch ?? "main",
    singleBranch: true,
    onAuth: onAuthFor(opts.token),
  });
  const [head] = await log({ fs, dir, depth: 1 });
  if (!head) throw new Error(`fetchExternalBase: clone of ${opts.url} produced no commits`);
  return head.oid;
}
