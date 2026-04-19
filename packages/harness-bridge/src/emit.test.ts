import { describe, it, expect, afterEach } from "vitest"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parse as parseYaml } from "yaml"
import type { ExecutionLog } from "@factory/schemas"
import { emitExecutionLog } from "./emit.js"

const tempDirs: string[] = []

afterEach(async () => {
  for (const d of tempDirs.splice(0)) {
    await rm(d, { recursive: true, force: true })
  }
})

async function makeTempDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "harness-bridge-emit-test-"))
  tempDirs.push(d)
  return d
}

const sampleLog: ExecutionLog = {
  id: "EL-WG-META-FOO-2026-04-19T18-00-00-000Z",
  source_refs: ["WG-META-FOO"],
  explicitness: "explicit",
  rationale: "test",
  workGraphId: "WG-META-FOO",
  adapterId: "dry-run",
  timestamp: "2026-04-19T18:00:00.000Z",
  status: "completed",
  nodes: [
    {
      nodeId: "CONTRACT-META-FOO-A",
      status: "simulated",
      rationale: "dry-run",
    },
  ],
}

describe("emitExecutionLog", () => {
  it("writes the log to <dir>/<id>.yaml", async () => {
    const dir = await makeTempDir()
    const path = await emitExecutionLog(sampleLog, dir)
    expect(path).toBe(join(dir, `${sampleLog.id}.yaml`))
    const content = await readFile(path, "utf8")
    const parsed = parseYaml(content)
    expect(parsed.id).toBe(sampleLog.id)
    expect(parsed.status).toBe("completed")
  })

  it("creates the destination directory if missing", async () => {
    const parent = await makeTempDir()
    const nested = join(parent, "nested", "execution-logs")
    const path = await emitExecutionLog(sampleLog, nested)
    const content = await readFile(path, "utf8")
    expect(content).toContain(sampleLog.id)
  })

  it("YAML round-trips the per-node records", async () => {
    const dir = await makeTempDir()
    const path = await emitExecutionLog(sampleLog, dir)
    const parsed = parseYaml(await readFile(path, "utf8"))
    expect(parsed.nodes[0].nodeId).toBe("CONTRACT-META-FOO-A")
    expect(parsed.nodes[0].status).toBe("simulated")
  })
})
