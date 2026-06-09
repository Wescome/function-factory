export interface SeedWorkspaceFile {
  path: string
  content: string
}

export interface SeedWorkspace {
  schemaVersion: "1.0"
  issue?: string
  acceptance?: string[]
  testCommand?: string
  files: SeedWorkspaceFile[]
}

interface ParsedFilePatch {
  oldPath: string | null
  newPath: string | null
  hunks: ParsedHunk[]
}

interface ParsedHunk {
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  lines: Array<{ type: "context" | "add" | "remove"; text: string }>
}

export function parseSeedWorkspace(content: string): SeedWorkspace {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch (err) {
    throw new Error(`invalid SeedWorkspace JSON: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("SeedWorkspace must be a JSON object")
  }
  const record = parsed as Record<string, unknown>
  if (record.schemaVersion !== "1.0") {
    throw new Error("SeedWorkspace schemaVersion must be 1.0")
  }
  if (!Array.isArray(record.files)) {
    throw new Error("SeedWorkspace files must be an array")
  }
  const files: SeedWorkspaceFile[] = []
  for (const file of record.files) {
    if (!file || typeof file !== "object" || Array.isArray(file)) {
      throw new Error("SeedWorkspace file entries must be objects")
    }
    const fileRecord = file as Record<string, unknown>
    if (typeof fileRecord.path !== "string" || typeof fileRecord.content !== "string") {
      throw new Error("SeedWorkspace file entries require string path and content")
    }
    assertSafeRelativePath(fileRecord.path)
    files.push({ path: fileRecord.path, content: fileRecord.content })
  }
  return {
    schemaVersion: "1.0",
    ...(typeof record.issue === "string" ? { issue: record.issue } : {}),
    ...(Array.isArray(record.acceptance)
      ? { acceptance: record.acceptance.filter((item): item is string => typeof item === "string") }
      : {}),
    ...(typeof record.testCommand === "string" ? { testCommand: record.testCommand } : {}),
    files,
  }
}

export function validatePatchAgainstSeedWorkspace(
  seedContent: string,
  patchContent: string,
): { passed: true } | { passed: false; message: string } {
  try {
    applyUnifiedDiffToSeedWorkspace(parseSeedWorkspace(seedContent), patchContent)
    return { passed: true }
  } catch (err) {
    return { passed: false, message: err instanceof Error ? err.message : String(err) }
  }
}

export function applyUnifiedDiffToSeedWorkspace(
  seed: SeedWorkspace,
  patchContent: string,
): { files: Record<string, string> } {
  const files = Object.fromEntries(seed.files.map((file) => [file.path, file.content]))
  const filePatches = parseUnifiedDiff(patchContent)
  if (filePatches.length === 0) {
    throw new Error("patch contains no file hunks")
  }

  for (const filePatch of filePatches) {
    const targetPath = normalizeDiffPath(filePatch.newPath ?? filePatch.oldPath)
    if (!targetPath) throw new Error("patch missing target path")
    assertSafeRelativePath(targetPath)

    const oldIsDevNull = filePatch.oldPath === null
    if (oldIsDevNull && files[targetPath] !== undefined) {
      throw new Error(`target file already exists in SeedWorkspace: ${targetPath}`)
    }
    if (!oldIsDevNull && files[targetPath] === undefined) {
      throw new Error(`target file missing from SeedWorkspace: ${targetPath}`)
    }

    const sourceLines = splitContentLines(oldIsDevNull ? "" : files[targetPath] ?? "")
    const nextLines: string[] = []
    let sourceIndex = 0

    for (const hunk of filePatch.hunks) {
      const hunkStartIndex = Math.max(0, hunk.oldStart - 1)
      while (sourceIndex < hunkStartIndex) {
        nextLines.push(sourceLines[sourceIndex] ?? "")
        sourceIndex++
      }

      for (const line of hunk.lines) {
        if (line.type === "add") {
          nextLines.push(line.text)
          continue
        }
        const actual = sourceLines[sourceIndex]
        if (actual !== line.text) {
          const kind = line.type === "remove" ? "removal" : "context"
          throw new Error(`hunk ${kind} mismatch for ${targetPath}: expected ${JSON.stringify(line.text)} got ${JSON.stringify(actual)}`)
        }
        if (line.type === "context") nextLines.push(actual)
        sourceIndex++
      }
    }

    while (sourceIndex < sourceLines.length) {
      nextLines.push(sourceLines[sourceIndex] ?? "")
      sourceIndex++
    }
    files[targetPath] = joinContentLines(nextLines)
  }

  return { files }
}

function parseUnifiedDiff(content: string): ParsedFilePatch[] {
  const lines = content.split(/\r?\n/)
  const patches: ParsedFilePatch[] = []
  let current: ParsedFilePatch | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ""
    if (line.startsWith("diff --git ")) {
      if (current) patches.push(current)
      current = { oldPath: null, newPath: null, hunks: [] }
      continue
    }
    if (!current) continue
    if (line.startsWith("--- ")) {
      current.oldPath = parseDiffMarker(line.slice(4))
      continue
    }
    if (line.startsWith("+++ ")) {
      current.newPath = parseDiffMarker(line.slice(4))
      continue
    }
    const header = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
    if (header) {
      const hunk: ParsedHunk = {
        oldStart: Number(header[1]),
        oldCount: Number(header[2] ?? "1"),
        newStart: Number(header[3]),
        newCount: Number(header[4] ?? "1"),
        lines: [],
      }
      current.hunks.push(hunk)
      for (i++; i < lines.length; i++) {
        const hunkLine = lines[i] ?? ""
        if (hunkLine.startsWith("diff --git ") || hunkLine.startsWith("@@ ")) {
          i--
          break
        }
        if (hunkLine === "\\ No newline at end of file" || hunkLine === "") {
          if (i === lines.length - 1) break
        }
        if (hunkLine.startsWith("+") && !hunkLine.startsWith("+++")) {
          hunk.lines.push({ type: "add", text: hunkLine.slice(1) })
        } else if (hunkLine.startsWith("-") && !hunkLine.startsWith("---")) {
          hunk.lines.push({ type: "remove", text: hunkLine.slice(1) })
        } else if (hunkLine.startsWith(" ")) {
          hunk.lines.push({ type: "context", text: hunkLine.slice(1) })
        } else if (hunkLine.length > 0) {
          throw new Error(`unsupported hunk line: ${hunkLine}`)
        }
      }
    }
  }

  if (current) patches.push(current)
  return patches.filter((patch) => patch.hunks.length > 0)
}

function parseDiffMarker(marker: string): string | null {
  const trimmed = marker.trim().split(/\s+/)[0] ?? ""
  if (trimmed === "/dev/null") return null
  return normalizeDiffPath(trimmed)
}

function normalizeDiffPath(path: string | null): string | null {
  if (!path) return null
  return path.replace(/^[ab]\//, "")
}

function splitContentLines(content: string): string[] {
  if (content.length === 0) return []
  const lines = content.split("\n")
  if (lines[lines.length - 1] === "") lines.pop()
  return lines
}

function joinContentLines(lines: string[]): string {
  return `${lines.join("\n")}\n`
}

function assertSafeRelativePath(path: string): void {
  if (
    path.length === 0 ||
    path.startsWith("/") ||
    path.includes("\0") ||
    path.split("/").some((part) => part === "..")
  ) {
    throw new Error(`unsafe seed workspace path: ${path}`)
  }
}
