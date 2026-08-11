/**
 * PLAYBOOK-KEEL-SCR-PORT-2/3: a small, disclosed isomorphic-git-compatible
 * `fs`, extracted here (PORT-3) so both `IsomorphicGitComposer` (the
 * atomic `branch({object,force})` ref move) and PORT-3's `GitTargetProbe`
 * (`listFiles`/`readBlob`/`resolveRef`, reading the external repo's real
 * history) share ONE implementation instead of two copies drifting apart.
 *
 * Mirrors `@cloudflare/shell`'s own (unexported) `createGitFs`/`GitStat`
 * adapter -- `@cloudflare/shell`'s `createGit()` wraps a `WorkspaceFileSystem`
 * into this SAME shape internally, but never exports the wrapper, so any
 * caller reaching isomorphic-git's own public functions directly (the
 * public door OD-PORT-2 established) needs its own copy. See
 * `isomorphic-git-composer.adapter.ts`'s own header for the fuller story
 * of why this exists, including the live bug it already caught
 * (isomorphic-git's `stat`/`lstat` need `.isFile()`/`.isDirectory()`
 * METHODS, not KEEL's plain `{type,size,mtime,mode}`).
 */
import type { FileSystem } from "@cloudflare/shell";

/** isomorphic-git's `stat`/`lstat` expect a Node `fs.Stats`-shaped object
 *  with `.isFile()`/`.isDirectory()`/`.isSymbolicLink()` METHODS. Mirrors
 *  `@cloudflare/shell`'s own (unexported) `GitStat` wrapper exactly. */
class GitStat {
  readonly size: number;
  readonly mtime: Date;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
  readonly ino = 0;
  readonly uid = 0;
  readonly gid = 0;
  readonly dev = 0;
  readonly mode: number;
  #type: string;
  constructor(stat: { type: string; size: number; mtime: Date; mode?: number }) {
    this.#type = stat.type;
    this.size = stat.size;
    this.mtime = stat.mtime;
    this.mtimeMs = stat.mtime.getTime();
    this.ctimeMs = this.mtimeMs;
    this.mode = stat.mode ?? (this.#type === "directory" ? 16877 : this.#type === "symlink" ? 40960 : 33188);
  }
  isFile() { return this.#type === "file"; }
  isDirectory() { return this.#type === "directory"; }
  isSymbolicLink() { return this.#type === "symlink"; }
}

/** isomorphic-git dispatches on a thrown error's `.code` (e.g. `ENOENT`
 *  for a missing stat target, part of its normal "does this ref/loose
 *  object exist" probing) -- preserves a real code if the underlying
 *  error already carries one, defaults to ENOENT otherwise. Mirrors
 *  `@cloudflare/shell`'s own (unexported) `fsError`. */
function fsError(path: string, cause: unknown): Error & { code: string } {
  if (cause instanceof Error && "code" in cause && typeof (cause as { code: unknown }).code === "string") {
    return cause as Error & { code: string };
  }
  const err = new Error(cause instanceof Error ? cause.message : `ENOENT: ${path}`) as Error & { code: string };
  err.code = "ENOENT";
  return err;
}

/** A minimal isomorphic-git-compatible `fs`, built from any KEEL
 *  `FileSystem` (in practice, always a `WorkspaceFileSystem`). */
export function isomorphicGitFs(fs: FileSystem) {
  return {
    promises: {
      async readFile(path: string, options?: string | { encoding?: string }) {
        const encoding = typeof options === "string" ? options : options?.encoding;
        if (encoding === "utf8" || encoding === "utf-8") return fs.readFile(path);
        return fs.readFileBytes(path);
      },
      async writeFile(path: string, data: string | Uint8Array) {
        const parent = path.replace(/\/[^/]+$/, "");
        if (parent && parent !== "/" && parent !== path) {
          try { await fs.mkdir(parent, { recursive: true }); } catch { /* already exists */ }
        }
        if (typeof data === "string") await fs.writeFile(path, data);
        else await fs.writeFileBytes(path, data);
      },
      async unlink(path: string) {
        try { await fs.rm(path); } catch (err) { throw fsError(path, err); }
      },
      async readdir(path: string) { return fs.readdir(path); },
      async mkdir(path: string, mode?: boolean | { recursive?: boolean }) {
        const recursive = typeof mode === "object" ? mode.recursive : false;
        await fs.mkdir(path, { recursive });
      },
      async rmdir(path: string) { await fs.rm(path); },
      async stat(path: string) {
        try { return new GitStat(await fs.stat(path)); } catch (err) { throw fsError(path, err); }
      },
      async lstat(path: string) {
        try { return new GitStat(await fs.lstat(path)); } catch (err) { throw fsError(path, err); }
      },
      async readlink(path: string) {
        try { return await fs.readlink(path); } catch (err) { throw fsError(path, err); }
      },
      async symlink(target: string, path: string) { await fs.symlink(target, path); },
      async chmod(_path: string, _mode: number) { /* no-op, matches @cloudflare/shell's own adapter */ },
    },
  };
}
