// PLAYBOOK-KEEL-WORKSPACE-001: read-only repository access from inside the
// codemode isolate. `@cloudflare/shell`'s `stateTools`/`gitTools` return a
// `ToolProvider` (its own composition entry point, for `resolveProvider()` +
// `executor.execute(code, [providers])`) — not KEEL's `CodemodeConnector`
// shape, which `makeRuntime` requires. Worse: `@cloudflare/shell@0.4.3` pins
// `@cloudflare/codemode: ^0.5.0` while KEEL is pinned to `0.4.2` (confirmed:
// `npm ls @cloudflare/codemode` shows shell nesting its own 0.5.0 copy) — so
// even a `CodemodeConnector`-shaped export from shell (`stateConnector` in
// `@cloudflare/shell/workers`) would nominally extend a DIFFERENT class than
// this file's `CodemodeConnector` import. Route around both problems: use
// only the codemode-independent exports (`Workspace`, `WorkspaceFileSystem`
// from the package root, `createGit` from `@cloudflare/shell/git`) and mirror
// `weather.codemode.ts`'s hand-written connector shape exactly, on KEEL's own
// pinned codemode.
import { CodemodeConnector } from "@cloudflare/codemode";
import { Workspace, WorkspaceFileSystem } from "@cloudflare/shell";
import { createGit } from "@cloudflare/shell/git";
import type { CallRecorder } from "../codemode/call-recorder";

/** Read methods only (A.3 scope): no writeFile, no commit/push. */
export class WorkspaceStateConnector extends CodemodeConnector<unknown> {
  constructor(ctx: unknown, env: unknown, private readonly workspace: Workspace, private readonly rec?: CallRecorder) {
    super(ctx as never, env as never);
  }
  override name() { return "state"; }
  override tools() {
    const ws = this.workspace, rec = this.rec;
    return {
      readFile: {
        description: "state.readFile({path}) => file content as a string.",
        execute: async (a: unknown) => {
          const { path } = (a ?? {}) as { path: string };
          const r = await ws.readFile(path);
          rec?.record("state", "readFile", { path }, r);
          return r;
        },
      },
      glob: {
        description: "state.glob({pattern}) => matching FileInfo[].",
        execute: async (a: unknown) => {
          const { pattern } = (a ?? {}) as { pattern: string };
          const r = await ws.glob(pattern);
          rec?.record("state", "glob", { pattern }, r);
          return r;
        },
      },
      stat: {
        description: "state.stat({path}) => FileStat | null.",
        execute: async (a: unknown) => {
          const { path } = (a ?? {}) as { path: string };
          const r = await ws.stat(path);
          rec?.record("state", "stat", { path }, r);
          return r;
        },
      },
      diff: {
        description: "state.diff({pathA, pathB}) => unified diff string.",
        execute: async (a: unknown) => {
          const { pathA, pathB } = (a ?? {}) as { pathA: string; pathB: string };
          const r = await ws.diff(pathA, pathB);
          rec?.record("state", "diff", { pathA, pathB }, r);
          return r;
        },
      },
    };
  }
}

/** Read methods only: clone (fetch, no local write side-effect the model
 *  controls), log, status, diff. No commit/push/add/rm exposed. */
export class WorkspaceGitConnector extends CodemodeConnector<unknown> {
  private readonly git: ReturnType<typeof createGit>;
  constructor(ctx: unknown, env: unknown, workspace: Workspace, private readonly rec?: CallRecorder) {
    super(ctx as never, env as never);
    this.git = createGit(new WorkspaceFileSystem(workspace));
  }
  override name() { return "git"; }
  override tools() {
    const git = this.git, rec = this.rec;
    return {
      clone: {
        description: "git.clone({url, depth?, branch?, singleBranch?}) => {cloned, dir}.",
        execute: async (a: unknown) => {
          const args = (a ?? {}) as { url: string; depth?: number; branch?: string; singleBranch?: boolean };
          const r = await git.clone(args);
          rec?.record("git", "clone", args, r);
          return r;
        },
      },
      log: {
        description: "git.log({depth?, ref?}) => GitLogEntry[].",
        execute: async (a: unknown) => {
          const args = (a ?? {}) as { depth?: number; ref?: string };
          const r = await git.log(args);
          rec?.record("git", "log", args, r);
          return r;
        },
      },
      status: {
        description: "git.status() => GitStatusEntry[].",
        execute: async () => {
          const r = await git.status();
          rec?.record("git", "status", {}, r);
          return r;
        },
      },
      diff: {
        description: "git.diff() => changed-file list.",
        execute: async () => {
          const r = await git.diff();
          rec?.record("git", "diff", {}, r);
          return r;
        },
      },
    };
  }
}
