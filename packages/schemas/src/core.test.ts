import { describe, it, expect } from "vitest"
import { FactoryMode, NodeExecutable, WorkGraphNode } from "./core.js"

describe("FactoryMode", () => {
  it("parses bootstrap", () => {
    expect(FactoryMode.parse("bootstrap")).toBe("bootstrap")
  })

  it("parses steady_state", () => {
    expect(FactoryMode.parse("steady_state")).toBe("steady_state")
  })

  it("rejects capitalized variants (case-sensitive)", () => {
    expect(FactoryMode.safeParse("Bootstrap").success).toBe(false)
  })

  it("rejects hyphenated steady-state (underscore required)", () => {
    expect(FactoryMode.safeParse("steady-state").success).toBe(false)
  })

  it("rejects empty string", () => {
    expect(FactoryMode.safeParse("").success).toBe(false)
  })

  it("rejects null", () => {
    expect(FactoryMode.safeParse(null).success).toBe(false)
  })

  it("exposes options as readonly array", () => {
    expect(FactoryMode.options).toEqual(["bootstrap", "steady_state"])
  })
})

describe("NodeExecutable", () => {
  it("accepts shell with command, default args []", () => {
    const parsed = NodeExecutable.safeParse({ kind: "shell", command: "git" })
    expect(parsed.success).toBe(true)
    if (parsed.success && parsed.data.kind === "shell") {
      expect(parsed.data.args).toEqual([])
    }
  })

  it("accepts shell with explicit args", () => {
    expect(
      NodeExecutable.safeParse({ kind: "shell", command: "git", args: ["log"] })
        .success
    ).toBe(true)
  })

  it("accepts in_process with handler_ref", () => {
    expect(
      NodeExecutable.safeParse({
        kind: "in_process",
        handler_ref: "v2.classify_commits",
      }).success
    ).toBe(true)
  })

  it("rejects unknown kind", () => {
    expect(
      NodeExecutable.safeParse({ kind: "docker", image: "alpine" }).success
    ).toBe(false)
  })

  it("rejects missing kind discriminator", () => {
    expect(NodeExecutable.safeParse({ command: "git" }).success).toBe(false)
  })

  it("rejects shell with empty command", () => {
    expect(
      NodeExecutable.safeParse({ kind: "shell", command: "" }).success
    ).toBe(false)
  })

  it("rejects shell with non-array args", () => {
    expect(
      NodeExecutable.safeParse({ kind: "shell", command: "git", args: "log" })
        .success
    ).toBe(false)
  })

  it("rejects in_process with empty handler_ref", () => {
    expect(
      NodeExecutable.safeParse({ kind: "in_process", handler_ref: "" }).success
    ).toBe(false)
  })
})

describe("WorkGraphNode — executable field", () => {
  const baseNode = {
    id: "CONTRACT-META-FOO",
    type: "execution" as const,
    title: "t",
  }

  it("parses successfully without executable (backward compat)", () => {
    const parsed = WorkGraphNode.safeParse(baseNode)
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.executable).toBeUndefined()
  })

  it("accepts shell executable and round-trips", () => {
    const node = {
      ...baseNode,
      executable: { kind: "shell", command: "git", args: ["log"] } as const,
    }
    const parsed = WorkGraphNode.safeParse(node)
    expect(parsed.success).toBe(true)
    if (parsed.success && parsed.data.executable?.kind === "shell") {
      expect(parsed.data.executable.command).toBe("git")
      expect(parsed.data.executable.args).toEqual(["log"])
    }
  })

  it("accepts in_process executable and round-trips", () => {
    const node = {
      ...baseNode,
      executable: {
        kind: "in_process",
        handler_ref: "v2.classify_commits",
      } as const,
    }
    const parsed = WorkGraphNode.safeParse(node)
    expect(parsed.success).toBe(true)
    if (parsed.success && parsed.data.executable?.kind === "in_process") {
      expect(parsed.data.executable.handler_ref).toBe("v2.classify_commits")
    }
  })

  it("rejects malformed executable (shell missing command)", () => {
    const node = { ...baseNode, executable: { kind: "shell" } }
    expect(WorkGraphNode.safeParse(node).success).toBe(false)
  })
})
