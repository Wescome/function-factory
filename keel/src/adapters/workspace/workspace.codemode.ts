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
//
// PLAYBOOK-KEEL-WRITE-ROLLBACK-001 (A2): the write fold, plus rollback built
// on codemode's OWN native mechanism (docs/codemode/runtime.md#rollback,
// docs/codemode/connectors.md) rather than a hand-rolled parallel one:
// `ConnectorTool.revert(args, result, ctx)` and `runtime.rollback({
// executionId})`, which walks the execution's tool-call log BACKWARD and
// calls every applied tool's `revert` — codemode already gives "reverse
// order" and "revert marker" (`ToolLogEntryState` includes "reverted") for
// free; this file only has to supply correct `revert` closures.
//
// Pre-image design (INV-RB-PREIMAGE, content-addressed by ContentHash): a
// write's `execute()` captures the PRIOR content (or an absent marker)
// BEFORE writing, hashes it, and stores the blob at `/.keel/rollback/<hash>`
// IN THE SAME WORKSPACE (no second journal — "the connector log" IS where
// the reference lives: it rides home in the call's own recorded `result`,
// which codemode's durable log already stores and hands back to `revert`).
// A large unchanged file dedups to its hash: the blob is only written if
// that hash isn't already present. `revert()` ALWAYS re-captures (snapshots)
// the about-to-be-reverted content the same way before restoring the
// pre-image — so an ESCALATE's revert (C.5) gets its "snapshot then revert"
// for free, without needing to distinguish AMEND vs ESCALATE inside the
// connector (the loop, not the connector, decides WHEN to revert).
import { CodemodeConnector, type ConnectorTools } from "@cloudflare/codemode";
import { Workspace, WorkspaceFileSystem } from "@cloudflare/shell";
import { createGit } from "@cloudflare/shell/git";
import { requiresApprovalFor } from "../../domain/index";
// PLAYBOOK-KEEL-SCR-PORT-4 (Track 2): `state.writeSection` writes in SCR's
// own section representation -- the SAME one `IsomorphicGitComposer` reads
// and writes when it materialises hunks. One representation, not two.
import { parseFile, renderFile } from "../../scr/vcs";
import type { CallRecorder } from "../codemode/call-recorder";

const PREIMAGE_DIR = "/.keel/rollback";

async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

type PreImage = { readonly present: true; readonly hash: string } | { readonly present: false };

/** Content-address the CURRENT content at `path` (or an absent marker) and
 *  store the blob if new. Fail-closed (C.1): a directory at `path` (EISDIR)
 *  propagates rather than being swallowed into a false "absent". */
async function capturePreImage(ws: Workspace, path: string): Promise<PreImage> {
  const content = await ws.readFile(path); // null for missing (not a throw); EISDIR still throws
  if (content === null) return { present: false };
  const hash = await sha256hex(content);
  const blobPath = `${PREIMAGE_DIR}/${hash}`;
  if (!(await ws.exists(blobPath))) await ws.writeFile(blobPath, content);
  return { present: true, hash };
}

/** Restore `path` to a captured pre-image: recreate its content, or delete
 *  it if the pre-image was "absent" (it was created by the write being
 *  reverted). Fail-closed: a missing blob for a `present` pre-image throws
 *  rather than silently no-op'ing (INV-RB-ATOMIC — a revert that can't
 *  complete must surface as a failure, not a quiet partial revert). */
async function restorePreImage(ws: Workspace, path: string, pre: PreImage): Promise<void> {
  if (!pre.present) {
    await ws.rm(path, { force: true });
    return;
  }
  const blobPath = `${PREIMAGE_DIR}/${pre.hash}`;
  const content = await ws.readFile(blobPath);
  if (content === null) throw new Error(`rollback: pre-image blob missing for ${path} (hash ${pre.hash})`);
  await ws.writeFile(path, content);
}

/** Snapshot the about-to-be-reverted content, then restore the pre-image
 *  captured at write time. The snapshot is the SAME content-addressing
 *  primitive (`capturePreImage`) — it's for inspection only; nothing reads
 *  it back except an operator who already has the hash from the log. */
async function snapshotThenRestore(ws: Workspace, path: string, pre: PreImage): Promise<void> {
  await capturePreImage(ws, path);
  await restorePreImage(ws, path, pre);
}

export class WorkspaceStateConnector extends CodemodeConnector<unknown> {
  constructor(ctx: unknown, env: unknown, private readonly workspace: Workspace, private readonly rec?: CallRecorder) {
    super(ctx as never, env as never);
  }
  override name() { return "state"; }
  override tools(): ConnectorTools {
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
      // --- writes (PLAYBOOK-KEEL-WRITE-ROLLBACK-001) -------------------------
      writeFile: {
        description: "state.writeFile({path, content}) => {ok, path}. Write-effectful, approval-gated.",
        requiresApproval: requiresApprovalFor("state", "writeFile"),
        execute: async (a: unknown) => {
          const { path, content } = (a ?? {}) as { path: string; content: string };
          const preImage = await capturePreImage(ws, path); // C.1: fail-closed if this throws -- the write never runs
          await ws.writeFile(path, content);
          const r = { ok: true, path, preImage };
          rec?.record("state", "writeFile", { path, content }, r);
          return r;
        },
        revert: async (_args: unknown, result: unknown) => {
          const { path, preImage } = result as { path: string; preImage: PreImage };
          await snapshotThenRestore(ws, path, preImage);
        },
      },
      // PLAYBOOK-KEEL-SCR-PORT-4 (Track 2, locked decision 1): the sub-file
      // write. `writeFile` above stays exactly what it is -- whole-file,
      // unchanged, and (for hunk purposes) the single anchor `"file"`, so
      // it still collides with anything else touching that path, which is
      // correct: a whole-file write really does claim the whole file.
      //
      // This one claims ONE anchored section. The on-disk representation
      // is SCR's own section format (`parseFile`/`renderFile`, vcs.ts) --
      // deliberately the SAME representation `IsomorphicGitComposer`
      // materialises hunks into, so what a slice writes and what the
      // review log composes are one language rather than two that have to
      // be kept in step. Every other section of the file is read back and
      // re-rendered untouched.
      writeSection: {
        description:
          "state.writeSection({path, anchor, content}) => {ok, path, anchor}. Write-effectful, approval-gated. " +
          "Writes ONE anchored section of a file, leaving every other section untouched. Prefer this over " +
          "writeFile when other work may touch a different part of the same file.",
        requiresApproval: requiresApprovalFor("state", "writeSection"),
        execute: async (a: unknown) => {
          const { path, anchor, content } = (a ?? {}) as { path: string; anchor: string; content: string };
          const preImage = await capturePreImage(ws, path); // C.1: fail-closed if this throws -- the write never runs
          const existing = await ws.readFile(path);
          const sections = existing !== null ? parseFile(existing) : new Map<string, string>();
          sections.set(anchor, content);
          await ws.writeFile(path, renderFile(sections));
          const r = { ok: true, path, anchor, preImage };
          rec?.record("state", "writeSection", { path, anchor, content }, r);
          return r;
        },
        revert: async (_args: unknown, result: unknown) => {
          const { path, preImage } = result as { path: string; preImage: PreImage };
          await snapshotThenRestore(ws, path, preImage);
        },
      },
      rm: {
        description: "state.rm({path}) => {ok}. Write-effectful, approval-gated.",
        requiresApproval: requiresApprovalFor("state", "rm"),
        execute: async (a: unknown) => {
          const { path } = (a ?? {}) as { path: string };
          const preImage = await capturePreImage(ws, path);
          await ws.rm(path, { force: true });
          const r = { ok: true, path, preImage };
          rec?.record("state", "rm", { path }, r);
          return r;
        },
        revert: async (_args: unknown, result: unknown) => {
          const { path, preImage } = result as { path: string; preImage: PreImage };
          await snapshotThenRestore(ws, path, preImage);
        },
      },
      mv: {
        description: "state.mv({src, dest}) => {ok}. Write-effectful, approval-gated.",
        requiresApproval: requiresApprovalFor("state", "mv"),
        execute: async (a: unknown) => {
          const { src, dest } = (a ?? {}) as { src: string; dest: string };
          const srcPreImage = await capturePreImage(ws, src);
          const destPreImage = await capturePreImage(ws, dest);
          await ws.mv(src, dest);
          const r = { ok: true, src, dest, srcPreImage, destPreImage };
          rec?.record("state", "mv", { src, dest }, r);
          return r;
        },
        revert: async (_args: unknown, result: unknown) => {
          const { src, dest, srcPreImage, destPreImage } = result as {
            src: string; dest: string; srcPreImage: PreImage; destPreImage: PreImage;
          };
          // reverse order within the one call: restore dest first (undo the
          // overwrite/creation at dest), then recreate src.
          await snapshotThenRestore(ws, dest, destPreImage);
          await snapshotThenRestore(ws, src, srcPreImage);
        },
      },
      cp: {
        description: "state.cp({src, dest}) => {ok}. Write-effectful, approval-gated.",
        requiresApproval: requiresApprovalFor("state", "cp"),
        execute: async (a: unknown) => {
          const { src, dest } = (a ?? {}) as { src: string; dest: string };
          const destPreImage = await capturePreImage(ws, dest); // src is untouched by cp
          await ws.cp(src, dest);
          const r = { ok: true, src, dest, destPreImage };
          rec?.record("state", "cp", { src, dest }, r);
          return r;
        },
        revert: async (_args: unknown, result: unknown) => {
          const { dest, destPreImage } = result as { dest: string; destPreImage: PreImage };
          await snapshotThenRestore(ws, dest, destPreImage);
        },
      },
    };
  }
}

/** Read methods: clone, log, status, diff. Writes: add, commit (in-Workspace,
 *  reverted by resetting to the ref captured at attempt start — createGit
 *  exposes no native `reset`; `checkout({ref, force:true})` is the
 *  equivalent used here), and push (the one real-repo effect, INV-RB-
 *  VIRTUAL-ONLY: deliberately no `revert` -- rollback never un-pushes). */
export class WorkspaceGitConnector extends CodemodeConnector<unknown> {
  private readonly git: ReturnType<typeof createGit>;
  /** C.2: the ref at attempt start, captured lazily on the first git write
   *  within a given execution (keyed by executionId) so every write/revert
   *  in that same attempt resets to the SAME point, not a moving target. */
  private readonly attemptStartRef = new Map<string, string>();

  constructor(
    ctx: unknown,
    env: unknown,
    workspace: Workspace,
    private readonly rec?: CallRecorder,
    private readonly pushToken?: string,
  ) {
    super(ctx as never, env as never);
    this.git = createGit(new WorkspaceFileSystem(workspace));
  }
  override name() { return "git"; }

  private async captureAttemptStartRef(executionId: string | undefined): Promise<string | undefined> {
    if (!executionId) return undefined;
    const cached = this.attemptStartRef.get(executionId);
    if (cached) return cached;
    const log = await this.git.log({ depth: 1 });
    const ref = log[0]?.oid;
    if (ref) this.attemptStartRef.set(executionId, ref);
    return ref;
  }

  private async resetToAttemptStart(executionId: string | undefined): Promise<void> {
    const ref = executionId ? this.attemptStartRef.get(executionId) : undefined;
    if (!ref) return; // no commit existed yet at attempt start -- nothing to reset to
    await this.git.checkout({ ref, force: true });
  }

  override tools(): ConnectorTools {
    const git = this.git, rec = this.rec, pushToken = this.pushToken;
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
      // --- writes (PLAYBOOK-KEEL-WRITE-ROLLBACK-001) -------------------------
      add: {
        description: "git.add({filepath}) => {added}. Write-effectful, approval-gated.",
        requiresApproval: requiresApprovalFor("git", "add"),
        execute: async (a: unknown, ctx?: { executionId: string }) => {
          await this.captureAttemptStartRef(ctx?.executionId);
          const { filepath } = (a ?? {}) as { filepath: string };
          const r = await git.add({ filepath });
          rec?.record("git", "add", { filepath }, r);
          return r;
        },
        revert: async (_args: unknown, _result: unknown, ctx?: { executionId: string }) => {
          await this.resetToAttemptStart(ctx?.executionId);
        },
      },
      commit: {
        description: "git.commit({message}) => {oid, message}. Write-effectful, approval-gated.",
        requiresApproval: requiresApprovalFor("git", "commit"),
        execute: async (a: unknown, ctx?: { executionId: string }) => {
          await this.captureAttemptStartRef(ctx?.executionId);
          const { message } = (a ?? {}) as { message: string };
          const r = await git.commit({ message, author: { name: "keel", email: "keel@koales.workers.dev" } });
          rec?.record("git", "commit", { message }, r);
          return r;
        },
        revert: async (_args: unknown, _result: unknown, ctx?: { executionId: string }) => {
          await this.resetToAttemptStart(ctx?.executionId);
        },
      },
      push: {
        description: "git.push({remote?, ref?, force?}) => {ok, refs}. The one real-repo effect -- auth is injected server-side, the model never supplies or sees a token.",
        requiresApproval: requiresApprovalFor("git", "push"),
        execute: async (a: unknown) => {
          const args = (a ?? {}) as { remote?: string; ref?: string; force?: boolean };
          const r = await git.push({ ...args, token: pushToken });
          // never record the token, even though it was never in `args` to begin with (B.3/INV-RB-VIRTUAL-ONLY)
          rec?.record("git", "push", args, r);
          return r;
        },
        // Deliberately no `revert`: INV-RB-VIRTUAL-ONLY -- a landed push is a
        // real, external, one-way effect. codemode's rollback skips tools
        // without a revert (see docs/codemode/runtime.md#rollback), which is
        // exactly "rollback reverts the virtual Workspace only, never un-pushes."
      },
    };
  }
}
