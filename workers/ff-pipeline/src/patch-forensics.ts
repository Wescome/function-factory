export interface PatchPathValidationResult {
  patchStr: string
  droppedPaths: string[]
  isEmpty: boolean
}

interface DiffSection {
  lines: string[]
  paths: string[]
  hasHunk: boolean
}

export function validatePatchPaths(
  patchStr: string,
  seedFiles: Record<string, string>,
): PatchPathValidationResult {
  const sections = splitDiffSections(patchStr)
  const declaredPaths = new Set(Object.keys(seedFiles))
  const droppedPaths: string[] = []
  const droppedPathSet = new Set<string>()
  const keptSections: DiffSection[] = []

  for (const section of sections) {
    const undeclared = section.paths.filter((path) => !declaredPaths.has(path))
    if (undeclared.length === 0) {
      keptSections.push(section)
      continue
    }

    for (const path of undeclared) {
      if (droppedPathSet.has(path)) continue
      droppedPathSet.add(path)
      droppedPaths.push(path)
      console.log(`[FORENSIC] dropping undeclared path: ${path}`)
    }
  }

  const nextPatch = keptSections
    .filter((section) => section.hasHunk)
    .flatMap((section) => section.lines)
    .join("\n")
    .trimEnd()

  return {
    patchStr: nextPatch.length > 0 ? `${nextPatch}\n` : "",
    droppedPaths,
    isEmpty: nextPatch.length === 0,
  }
}

function splitDiffSections(patchStr: string): DiffSection[] {
  const lines = patchStr.split(/\r?\n/)
  const sections: DiffSection[] = []
  let current: string[] = []

  for (const line of lines) {
    if (line.startsWith("diff --git ") && current.length > 0) {
      sections.push(buildSection(current))
      current = []
    }

    if (current.length === 0 && !startsPatchSection(line)) {
      continue
    }

    current.push(line)
  }

  if (current.length > 0) {
    sections.push(buildSection(current))
  }

  return sections
}

function buildSection(lines: string[]): DiffSection {
  return {
    lines: trimTrailingEmptyLines(lines),
    paths: extractChangedPaths(lines),
    hasHunk: lines.some((line) => line.startsWith("@@ ")),
  }
}

function startsPatchSection(line: string): boolean {
  return (
    line.startsWith("diff --git ") ||
    line.startsWith("--- a/") ||
    line.startsWith("+++ b/")
  )
}

function extractChangedPaths(lines: string[]): string[] {
  const paths = new Set<string>()

  for (const line of lines) {
    if (line.startsWith("--- a/")) {
      paths.add(parseMarkerPath(line, "--- a/"))
    }
    if (line.startsWith("+++ b/")) {
      paths.add(parseMarkerPath(line, "+++ b/"))
    }
  }

  return Array.from(paths).filter((path) => path.length > 0)
}

function parseMarkerPath(line: string, prefix: "--- a/" | "+++ b/"): string {
  return (line.slice(prefix.length).trim().split(/\s+/)[0] ?? "").trim()
}

function trimTrailingEmptyLines(lines: string[]): string[] {
  let end = lines.length
  while (end > 0 && lines[end - 1] === "") end--
  return lines.slice(0, end)
}
