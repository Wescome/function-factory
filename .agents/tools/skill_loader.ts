/**
 * Skill loader.
 *
 * Three-stage progressive disclosure:
 *   1. Always read _index.md on session start (short, triggers visible).
 *   2. Load _manifest.jsonl for machine-readable metadata.
 *   3. Load full SKILL.md only when a trigger matches.
 *
 * Returns the matched skills' full content for injection into agent
 * context. Never loads skills that don't match; never dumps everything.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs"
import { join } from "node:path"

const SKILLS_DIR = ".agent/skills"
const MANIFEST = join(SKILLS_DIR, "_manifest.jsonl")

export interface SkillManifestEntry {
  name: string
  version: string
  triggers: string[]
  tools?: string[]
  preconditions?: string[]
  constraints?: string[]
  category?: string
}

export interface LoadedSkill {
  name: string
  constraints: string[]
  content: string
}

export function loadManifest(): SkillManifestEntry[] {
  if (!existsSync(MANIFEST)) return buildManifestFromSkillFiles()
  return readFileSync(MANIFEST, "utf-8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as SkillManifestEntry)
}

/**
 * Fallback: if _manifest.jsonl hasn't been materialized, parse each
 * SKILL.md's frontmatter in-memory. Slower; used during bootstrap.
 */
function buildManifestFromSkillFiles(): SkillManifestEntry[] {
  if (!existsSync(SKILLS_DIR)) return []
  const entries: SkillManifestEntry[] = []
  for (const dir of readdirSync(SKILLS_DIR)) {
    const skillPath = join(SKILLS_DIR, dir, "SKILL.md")
    if (!existsSync(skillPath)) continue
    const content = readFileSync(skillPath, "utf-8")
    const fm = content.match(/^---\n([\s\S]*?)\n---/)
    if (!fm) continue
    const body = fm[1]
    const entry: SkillManifestEntry = {
      name: extractYamlField(body, "name") ?? dir,
      version: extractYamlField(body, "version") ?? "unknown",
      triggers: extractYamlList(body, "triggers"),
      tools: extractYamlList(body, "tools"),
      preconditions: extractYamlList(body, "preconditions"),
      constraints: extractYamlList(body, "constraints"),
      category: extractYamlField(body, "category"),
    }
    entries.push(entry)
  }
  return entries
}

function extractYamlField(yaml: string, key: string): string | undefined {
  const m = yaml.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))
  return m?.[1]?.trim().replace(/^["']|["']$/g, "")
}

function extractYamlList(yaml: string, key: string): string[] {
  const m = yaml.match(
    new RegExp(`^${key}:\\n((?:\\s+-\\s+.+\\n?)+)`, "m")
  )
  if (!m) return []
  return m[1]
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("-"))
    .map((l) => l.slice(1).trim().replace(/^["']|["']$/g, ""))
}

export function matchTriggers(
  input: string,
  manifest: SkillManifestEntry[]
): SkillManifestEntry[] {
  const lower = input.toLowerCase()
  return manifest.filter((s) =>
    s.triggers.some((t) => lower.includes(t.toLowerCase()))
  )
}

export function checkPreconditions(skill: SkillManifestEntry): boolean {
  for (const p of skill.preconditions ?? []) {
    if (p.endsWith("exists")) {
      const path = p.replace(/ exists$/, "").trim()
      if (!existsSync(path)) return false
    }
  }
  return true
}

export function loadSkillFull(name: string): LoadedSkill | null {
  const skillPath = join(SKILLS_DIR, name, "SKILL.md")
  if (!existsSync(skillPath)) return null
  let content = readFileSync(skillPath, "utf-8")
  const knowledgePath = join(SKILLS_DIR, name, "KNOWLEDGE.md")
  if (existsSync(knowledgePath)) {
    content +=
      "\n\n---\n## Accumulated knowledge\n" + readFileSync(knowledgePath, "utf-8")
  }
  // Extract constraints from frontmatter for hook enforcement
  const fm = content.match(/^---\n([\s\S]*?)\n---/)
  const constraints = fm ? extractYamlList(fm[1], "constraints") : []
  return { name, constraints, content }
}

export function progressiveLoad(input: string): LoadedSkill[] {
  const manifest = loadManifest()
  const matches = matchTriggers(input, manifest)
  const loaded: LoadedSkill[] = []
  for (const s of matches) {
    if (!checkPreconditions(s)) continue
    const full = loadSkillFull(s.name)
    if (full) loaded.push(full)
  }
  return loaded
}
