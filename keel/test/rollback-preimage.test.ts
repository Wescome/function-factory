/**
 * PLAYBOOK-KEEL-WRITE-ROLLBACK-001 (C.1, C.3, C.5): pre-image capture and
 * revert, tested directly against the connectors + a real Workspace (backed
 * by the test env's D1 binding, namespaced per test so runs don't collide) --
 * the spec-loop-level test (workspace-write-rollback.test.ts) only reaches
 * the "created file -> deleted on revert" branch (nothing pre-existing to
 * restore, since every failed attempt's OWN writes are what get reverted,
 * and there is no ACCEPTED prior state within one run to build on). This
 * file covers the harder branch directly: an EXISTING file's prior content
 * restored, not just a created file removed.
 */
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { Workspace, WorkspaceFileSystem } from "@cloudflare/shell";
import { createGit } from "@cloudflare/shell/git";
import type { ConnectorTool, ConnectorTools } from "@cloudflare/codemode";
import { WorkspaceStateConnector, WorkspaceGitConnector } from "../src/adapters/workspace/workspace.codemode";

function freshWorkspace(namespace: string): Workspace {
  return new Workspace({ sql: (env as { DB: D1Database }).DB, namespace });
}

/** `ConnectorTools` is a `Record<string, ConnectorTool>`; with
 *  `noUncheckedIndexedAccess` every lookup is `| undefined`. These tests
 *  only ever look up tools this file itself declared, so a non-null lookup
 *  (not a cast) is the honest way to say "this key is always present". */
function tool(tools: ConnectorTools, name: string): ConnectorTool {
  const t = tools[name];
  if (!t) throw new Error(`tool not found: ${name}`);
  return t;
}

describe("PLAYBOOK-KEEL-WRITE-ROLLBACK-001 — state connector pre-image + revert", () => {
  it("writeFile's revert restores the file's PRIOR content (present pre-image)", async () => {
    const ws = freshWorkspace("wr_pre_writefile_1");
    await ws.writeFile("/x.txt", "original");
    const tools = new WorkspaceStateConnector({}, {}, ws).tools();
    const writeFile = tool(tools, "writeFile");

    const result = await writeFile.execute({ path: "/x.txt", content: "changed" });
    expect(await ws.readFile("/x.txt")).toBe("changed");

    await writeFile.revert!({ path: "/x.txt", content: "changed" }, result);
    expect(await ws.readFile("/x.txt")).toBe("original");
  });

  it("writeFile's revert deletes a file that didn't exist before (absent pre-image)", async () => {
    const ws = freshWorkspace("wr_pre_writefile_2");
    const tools = new WorkspaceStateConnector({}, {}, ws).tools();
    const writeFile = tool(tools, "writeFile");

    const result = await writeFile.execute({ path: "/new.txt", content: "created" });
    expect(await ws.readFile("/new.txt")).toBe("created");

    await writeFile.revert!({ path: "/new.txt", content: "created" }, result);
    expect(await ws.readFile("/new.txt")).toBeNull();
  });

  it("rm's revert recreates the deleted file with its original content", async () => {
    const ws = freshWorkspace("wr_pre_rm_1");
    await ws.writeFile("/y.txt", "keep-me");
    const tools = new WorkspaceStateConnector({}, {}, ws).tools();
    const rm = tool(tools, "rm");

    const result = await rm.execute({ path: "/y.txt" });
    expect(await ws.readFile("/y.txt")).toBeNull();

    await rm.revert!({ path: "/y.txt" }, result);
    expect(await ws.readFile("/y.txt")).toBe("keep-me");
  });

  it("mv's revert restores BOTH src (recreated) and dest (its own prior content or absence)", async () => {
    const ws = freshWorkspace("wr_pre_mv_1");
    await ws.writeFile("/src.txt", "src-content");
    await ws.writeFile("/dest.txt", "dest-was-here");
    const tools = new WorkspaceStateConnector({}, {}, ws).tools();
    const mv = tool(tools, "mv");

    const result = await mv.execute({ src: "/src.txt", dest: "/dest.txt" });
    expect(await ws.readFile("/src.txt")).toBeNull();
    expect(await ws.readFile("/dest.txt")).toBe("src-content");

    await mv.revert!({ src: "/src.txt", dest: "/dest.txt" }, result);
    expect(await ws.readFile("/src.txt")).toBe("src-content");
    expect(await ws.readFile("/dest.txt")).toBe("dest-was-here");
  });

  it("cp's revert restores dest to its prior content; src is untouched throughout", async () => {
    const ws = freshWorkspace("wr_pre_cp_1");
    await ws.writeFile("/src.txt", "src-content");
    await ws.writeFile("/dest.txt", "dest-was-here");
    const tools = new WorkspaceStateConnector({}, {}, ws).tools();
    const cp = tool(tools, "cp");

    const result = await cp.execute({ src: "/src.txt", dest: "/dest.txt" });
    expect(await ws.readFile("/dest.txt")).toBe("src-content");

    await cp.revert!({ src: "/src.txt", dest: "/dest.txt" }, result);
    expect(await ws.readFile("/dest.txt")).toBe("dest-was-here");
    expect(await ws.readFile("/src.txt")).toBe("src-content"); // never touched
  });

  it("a large unchanged file dedups to its hash: writing the same content twice stores the blob once", async () => {
    const ws = freshWorkspace("wr_pre_dedup_1");
    await ws.writeFile("/a.txt", "shared-content");
    await ws.writeFile("/b.txt", "shared-content"); // same bytes, different path
    const tools = new WorkspaceStateConnector({}, {}, ws).tools();
    const writeFile = tool(tools, "writeFile");

    const rA = (await writeFile.execute({ path: "/a.txt", content: "overwritten-a" })) as { preImage: { present: boolean; hash?: string } };
    const rB = (await writeFile.execute({ path: "/b.txt", content: "overwritten-b" })) as { preImage: { present: boolean; hash?: string } };
    expect(rA.preImage.present).toBe(true);
    expect(rB.preImage.present).toBe(true);
    expect(rA.preImage.hash).toBe(rB.preImage.hash); // same content -> same content-address
  });
});

describe("PLAYBOOK-KEEL-WRITE-ROLLBACK-001 (D.5) — git.push never un-pushes", () => {
  it("push declares no revert -- INV-RB-VIRTUAL-ONLY structurally, not by convention", async () => {
    const ws = freshWorkspace("wr_pre_push_1");
    const tools = new WorkspaceGitConnector({}, {}, ws).tools();
    expect(tool(tools, "push").revert).toBeUndefined();
    // every OTHER write-effectful tool DOES declare one, so this isn't an
    // oversight -- add/commit/writeFile/rm/mv/cp all have real revert closures.
    expect(tool(tools, "add").revert).toBeTypeOf("function");
    expect(tool(tools, "commit").revert).toBeTypeOf("function");
  });
});

describe("PLAYBOOK-KEEL-WRITE-ROLLBACK-001 — git connector attempt-start-ref revert", () => {
  it("commit's revert resets the working tree back to the ref captured at attempt start (C.2/C.3)", async () => {
    const ws = freshWorkspace("wr_pre_git_1");
    const fs = new WorkspaceFileSystem(ws);
    const rawGit = createGit(fs);
    await rawGit.init({});
    await ws.writeFile("/README.md", "v1");
    await rawGit.add({ filepath: "." });
    const first = await rawGit.commit({ message: "v1", author: { name: "t", email: "t@t.com" } });

    const tools = new WorkspaceGitConnector({}, {}, ws).tools();
    const add = tool(tools, "add");
    const commit = tool(tools, "commit");
    const executionId = "exec-attempt-1";

    // simulate one attempt: modify + add + commit (attempt-start ref
    // captured lazily on the FIRST git write in this executionId)
    await ws.writeFile("/README.md", "v2-in-progress");
    await add.execute({ filepath: "." }, { executionId });
    const commitResult = await commit.execute({ message: "v2" }, { executionId });
    const afterCommit = await rawGit.log({ depth: 1 });
    expect(afterCommit[0]!.oid).not.toBe(first.oid);

    // the attempt failed -> revert: reset to the ref captured at attempt start
    await commit.revert!({ message: "v2" }, commitResult, { executionId });
    const afterRevert = await rawGit.log({ depth: 1 });
    expect(afterRevert[0]!.oid).toBe(first.oid);
    expect(await ws.readFile("/README.md")).toBe("v1");
  });
});
