/**
 * PLAYBOOK-KEEL-COMPUTER-SWAP-001: isomorphic-git's `fs` port, built from
 * `@cloudflare/computer`'s own EXPORTED `WorkspaceFilesystem` class --
 * no reach-under. Replaces `isomorphic-git-fs.adapter.ts` (PORT-2/3's
 * mirror of `@cloudflare/shell`'s UNEXPORTED `createGitFs`/`GitStat`),
 * deleted alongside this file's introduction.
 *
 * One real mismatch remains, confirmed by reading computer's ACTUAL
 * `.d.ts` (not the playbook's own description of it, which claimed this
 * away as already solved): `WorkspaceFilesystem.stat()`/`.lstat()` return
 * `WorkspaceStatResult` with `isFile`/`isDirectory`/`isSymbolicLink` as
 * plain BOOLEAN FIELDS, not methods -- isomorphic-git needs `.isFile()`
 * etc. callable, matching Node's `fs.Stats` shape. This is the SAME class
 * of bug PORT-2's own `GitStat` existed to fix, one level further down
 * the stack now that the mirror it wrapped is gone. `StatShim` below is
 * the entire remaining adapter surface -- every other isomorphic-git fs
 * method maps onto a real, public, documented `WorkspaceFilesystem`
 * method; nothing here reaches into anything unexported.
 */
import type { Workspace } from "@cloudflare/computer";

// `WorkspaceFilesystem` (the class `Workspace.fs` returns) is used
// throughout computer's own `.d.ts` but is NOT itself in the package's
// public export list -- only `WorkspaceFilesystemStub` (its RPC-target
// wrapper) is. Derived via indexed access on the class that IS exported,
// rather than reaching into a dist-internal path for the real name.
type WorkspaceFilesystem = Workspace["fs"];

/** isomorphic-git dispatches on a thrown error's `.code` (e.g. `ENOENT`
 *  for a missing stat target, part of its normal "does this ref/loose
 *  object exist" probing) -- preserves a real code if the underlying
 *  error already carries one, defaults to ENOENT otherwise. Ported
 *  verbatim from the deleted mirror's own `fsError` helper. */
function fsError(path: string, cause: unknown): Error & { code: string } {
  if (cause instanceof Error && "code" in cause && typeof (cause as { code: unknown }).code === "string") {
    return cause as Error & { code: string };
  }
  const err = new Error(cause instanceof Error ? cause.message : `ENOENT: ${path}`) as Error & { code: string };
  err.code = "ENOENT";
  return err;
}

/** Wraps computer's `WorkspaceStatResult` (plain boolean fields) into the
 *  Node `fs.Stats`-shaped object isomorphic-git actually calls. */
class StatShim {
  readonly size: number;
  readonly mtime: Date;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
  readonly ino: number;
  readonly mode: number;
  readonly uid = 0;
  readonly gid = 0;
  readonly dev = 0;
  #isFile: boolean;
  #isDirectory: boolean;
  #isSymbolicLink: boolean;

  constructor(stat: { isFile: boolean; isDirectory: boolean; isSymbolicLink: boolean; mtime: number; size: number; mode: number; inode: number }) {
    this.#isFile = stat.isFile;
    this.#isDirectory = stat.isDirectory;
    this.#isSymbolicLink = stat.isSymbolicLink;
    this.size = stat.size;
    this.mtime = new Date(stat.mtime);
    this.mtimeMs = stat.mtime;
    this.ctimeMs = stat.mtime;
    this.ino = stat.inode;
    this.mode = stat.mode;
  }
  isFile() { return this.#isFile; }
  isDirectory() { return this.#isDirectory; }
  isSymbolicLink() { return this.#isSymbolicLink; }
}

/** A minimal isomorphic-git-compatible `fs`, built from computer's own
 *  `WorkspaceFilesystem`. */
export function computerGitFs(fs: WorkspaceFilesystem) {
  return {
    promises: {
      async readFile(path: string, options?: string | { encoding?: string }): Promise<string | Uint8Array> {
        try {
          const encoding = typeof options === "string" ? options : options?.encoding;
          if (encoding === "utf8" || encoding === "utf-8") return await fs.readFile(path, "utf8");
          const stream = await fs.readFile(path);
          return new Uint8Array(await new Response(stream).arrayBuffer());
        } catch (err) {
          throw fsError(path, err);
        }
      },
      async writeFile(path: string, data: string | Uint8Array) {
        const parent = path.replace(/\/[^/]+$/, "");
        if (parent && parent !== "/" && parent !== path) {
          try { await fs.mkdir(parent, { recursive: true }); } catch { /* already exists */ }
        }
        await fs.writeFile(path, data);
      },
      async unlink(path: string) {
        try { await fs.rm(path); } catch (err) { throw fsError(path, err); }
      },
      // Node's `fs.promises.readdir` (isomorphic-git's expectation) returns
      // plain filenames; computer's own `readdir` returns dirent-shaped
      // objects (`.name`, `.isFile`, ...).
      async readdir(path: string): Promise<string[]> {
        try { return (await fs.readdir(path)).map((e) => e.name); } catch (err) { throw fsError(path, err); }
      },
      async mkdir(path: string, mode?: boolean | { recursive?: boolean }) {
        const recursive = typeof mode === "object" ? mode.recursive : false;
        try { await fs.mkdir(path, { recursive }); } catch (err) { throw fsError(path, err); }
      },
      async rmdir(path: string) {
        try { await fs.rm(path); } catch (err) { throw fsError(path, err); }
      },
      async stat(path: string) {
        try { return new StatShim(await fs.stat(path)); } catch (err) { throw fsError(path, err); }
      },
      async lstat(path: string) {
        try { return new StatShim(await fs.lstat(path)); } catch (err) { throw fsError(path, err); }
      },
      async readlink(path: string) {
        try { return await fs.readlink(path); } catch (err) { throw fsError(path, err); }
      },
      async symlink(target: string, path: string) { await fs.symlink(target, path); },
      async chmod(path: string, mode: number) { await fs.chmod(path, mode); },
    },
  };
}
