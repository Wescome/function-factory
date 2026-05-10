#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const artifactIdPattern =
  /^(PRS|BC|FN|CONTRACT|FP|PRD|WG|INV|VAL|DEP|ATOM|CR|CTR|TRJ|PF|INC|DET|DEL|SIG|RGD|AC|ACS|RAD|EXS|EXT|EXR|EFF|EFFR|OBS|SNB|GOV|RPRS|DDI|CRL|SBI|PSR|GOVP|GOVD|GOVS|GOVA|GOVR|SRR|AMD|MR|CRP|VCR|MRP|TEP)-[A-Z0-9][A-Z0-9-]*$/
const markdownLinkPattern = /(!?\[[^\]]*\]\()([^)]+)(\))/g
const idLinePattern = /^\s*-?\s*id:\s*['"]?([^'"\s#]+)['"]?\s*$/
const sourceRefsInlinePattern = /^\s*source_refs:\s*\[(.*)\]\s*$/
const sourceRefsBlockPattern = /^\s*source_refs:\s*$/
const listItemPattern = /^(\s*)-\s+(.+?)\s*$/
const ignoredDirs = new Set(['.git', 'node_modules', 'dist', 'build', '.wrangler'])
const linkRoots = ['README.md', 'ARCHITECTURE.md', 'AGENTS.md', 'CLAUDE.md', 'GEMINI.md', 'docs', 'specs', '.agent']
const artifactRoots = ['specs']
const docsRoot = path.join(root, 'docs')
const virtualCompilerPrefixes = new Set(['ATOM'])
const externalBootstrapSignals = new Set(['SIG-EXT-1', 'SIG-FB-1', 'SIG-INF-1'])
const knownLineageGaps = new Set([
  // Historical candidate-reliability fixture cites a second observation outcome
  // that was never materialized under specs/observations/.
  'OBS-META-ARCHITECTURE-CANDIDATE-EXECUTION-2',
])
const requiredMigrationStubs = new Map([
  ['docs/STRATEGY_RECIPES_DOGFOOD.md', 'docs/how-to/STRATEGY_RECIPES_DOGFOOD.md'],
])

const markdownFiles = linkRoots.flatMap((entry) => collectFiles(path.join(root, entry), (file) => file.endsWith('.md')))
const specFiles = artifactRoots.flatMap((entry) =>
  collectFiles(path.join(root, entry), (file) => /\.(md|ya?ml|json)$/i.test(file)),
)
const artifactIndex = buildArtifactIndex(specFiles)
const linkFailures = checkMarkdownLinks(markdownFiles)
const docsStructure = checkDocsStructure(markdownFiles)
const lineage = checkSourceRefs(specFiles, artifactIndex)

for (const failure of linkFailures) {
  console.error(`broken-link ${formatLocation(failure.file, failure.line)} -> ${failure.target}`)
}

for (const failure of docsStructure.failures) {
  console.error(`${failure.kind} ${formatLocation(failure.file, failure.line)} -> ${failure.message}`)
}

for (const failure of lineage.failures) {
  console.error(`unresolved-source-ref ${formatLocation(failure.file, failure.line)} -> ${failure.ref}`)
}

console.log(
  [
    `markdown_files=${markdownFiles.length}`,
    `spec_files=${specFiles.length}`,
    `artifact_ids_indexed=${artifactIndex.size}`,
    `source_refs_checked=${lineage.checked}`,
    `virtual_refs=${lineage.virtualRefs}`,
    `external_signal_refs=${lineage.externalSignalRefs}`,
    `known_lineage_gaps=${lineage.knownGaps}`,
    `docs_section_readmes_checked=${docsStructure.sectionReadmesChecked}`,
    `docs_indexed_files_checked=${docsStructure.indexedFilesChecked}`,
    `migration_stubs_checked=${docsStructure.migrationStubsChecked}`,
  ].join(' '),
)

if (lineage.virtualRefs > 0) {
  console.log('note: virtual_refs are non-materialized compiler intermediates accepted by current ExecutableSpecification artifacts')
}

if (lineage.externalSignalRefs > 0) {
  console.log('note: external_signal_refs are bootstrap signal placeholders accepted by current signal batches')
}

if (lineage.knownGaps > 0) {
  console.log('note: known_lineage_gaps are historical unresolved refs explicitly named in scripts/audit-docs.mjs')
}

if (linkFailures.length > 0 || docsStructure.failures.length > 0 || lineage.failures.length > 0) {
  process.exit(1)
}

console.log('docs audit passed')

function collectFiles(target, predicate) {
  if (!existsSync(target)) return []

  const stats = statSync(target)
  if (stats.isFile()) return predicate(target) ? [target] : []
  if (!stats.isDirectory()) return []

  const name = path.basename(target)
  if (ignoredDirs.has(name)) return []

  return readdirSync(target, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(target, entry.name)
    if (entry.isDirectory()) {
      if (ignoredDirs.has(entry.name)) return []
      return collectFiles(child, predicate)
    }
    return predicate(child) ? [child] : []
  })
}

function buildArtifactIndex(files) {
  const index = new Map()

  for (const file of files) {
    const basename = path.basename(file).replace(/\.(md|ya?ml|json)$/i, '')
    if (artifactIdPattern.test(basename)) addArtifact(index, basename, file)

    const lines = readFileSync(file, 'utf8').split('\n')
    for (let indexLine = 0; indexLine < lines.length; indexLine += 1) {
      const match = lines[indexLine].match(idLinePattern)
      if (match && artifactIdPattern.test(match[1])) addArtifact(index, match[1], file)
    }
  }

  return index
}

function addArtifact(index, id, file) {
  if (!index.has(id)) index.set(id, new Set())
  index.get(id).add(relative(file))
}

function checkMarkdownLinks(files) {
  const failures = []

  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n')
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      let match
      const line = stripInlineCode(lines[lineIndex])
      while ((match = markdownLinkPattern.exec(line)) !== null) {
        const rawTarget = match[2].trim()
        if (isExternalLink(rawTarget)) continue

        const targetPath = normalizeMarkdownTarget(rawTarget)
        if (!targetPath) continue

        const resolved = path.resolve(path.dirname(file), targetPath)
        if (!existsSync(resolved)) {
          failures.push({ file, line: lineIndex + 1, target: rawTarget })
        }
      }
    }
  }

  return failures
}

function checkDocsStructure(files) {
  const docsFiles = files.filter((file) => isInsidePath(file, docsRoot) && file.endsWith('.md'))
  const sectionReadmes = checkDocsSectionReadmes(docsFiles)
  const migrationStubs = checkMigrationStubs(docsFiles)
  const indexTargets = buildDocsIndexTargets(docsFiles)
  const indexedDocs = checkIndexedDocs(docsFiles, indexTargets, migrationStubs.stubFiles)

  return {
    failures: [...sectionReadmes.failures, ...migrationStubs.failures, ...indexedDocs.failures],
    indexedFilesChecked: indexedDocs.checked,
    migrationStubsChecked: migrationStubs.checked,
    sectionReadmesChecked: sectionReadmes.checked,
  }
}

function checkDocsSectionReadmes(docsFiles) {
  const failures = []
  const sectionDirs = new Set(
    docsFiles
      .map((file) => path.dirname(file))
      .filter((directory) => directory !== docsRoot),
  )

  for (const directory of sectionDirs) {
    const readme = path.join(directory, 'README.md')
    if (!existsSync(readme)) {
      failures.push({
        file: directory,
        kind: 'missing-section-readme',
        line: 1,
        message: 'docs directories containing Markdown must include README.md',
      })
    }
  }

  return { checked: sectionDirs.size, failures }
}

function checkMigrationStubs(docsFiles) {
  const expectations = new Map(requiredMigrationStubs)
  const howToRoot = path.join(docsRoot, 'how-to')

  for (const file of docsFiles) {
    if (path.dirname(file) !== howToRoot || path.basename(file) === 'README.md') continue
    expectations.set(`docs/${path.basename(file)}`, relative(file))
  }

  const failures = []
  const stubFiles = new Set()

  for (const [stubRel, targetRel] of expectations) {
    const stubFile = path.join(root, stubRel)
    const targetFile = path.join(root, targetRel)
    stubFiles.add(stubRel)

    if (!existsSync(stubFile)) {
      failures.push({
        file: stubFile,
        kind: 'missing-migration-stub',
        line: 1,
        message: `expected compatibility stub for ${targetRel}`,
      })
      continue
    }

    if (!existsSync(targetFile)) {
      failures.push({
        file: stubFile,
        kind: 'missing-migration-target',
        line: 1,
        message: `expected moved document ${targetRel}`,
      })
      continue
    }

    if (!isMigrationStub(stubFile, targetFile)) {
      failures.push({
        file: stubFile,
        kind: 'invalid-migration-stub',
        line: 1,
        message: `stub must say the document moved and link to ${targetRel}`,
      })
    }
  }

  return { checked: expectations.size, failures, stubFiles }
}

function buildDocsIndexTargets(docsFiles) {
  const targets = new Set()
  const indexFiles = docsFiles.filter((file) => path.basename(file) === 'README.md')

  for (const file of indexFiles) {
    for (const target of markdownTargetsForFile(file)) {
      if (isExternalLink(target)) continue

      const targetPath = normalizeMarkdownTarget(target)
      if (!targetPath) continue

      const resolved = path.resolve(path.dirname(file), targetPath)
      if (isInsidePath(resolved, docsRoot) && resolved.endsWith('.md')) {
        targets.add(relative(resolved))
      }
    }
  }

  return targets
}

function checkIndexedDocs(docsFiles, indexTargets, migrationStubs) {
  const failures = []
  let checked = 0

  for (const file of docsFiles) {
    if (path.basename(file) === 'README.md') continue

    const rel = relative(file)
    if (migrationStubs.has(rel)) continue

    checked += 1
    if (!indexTargets.has(rel)) {
      failures.push({
        file,
        kind: 'orphan-doc',
        line: 1,
        message: 'document must be linked from docs/README.md or a docs section README',
      })
    }
  }

  return { checked, failures }
}

function isMigrationStub(stubFile, targetFile) {
  const content = readFileSync(stubFile, 'utf8')
  const announcesMove = /\bmoved\b/i.test(content) && /compatibility stub/i.test(content)
  if (!announcesMove) return false

  return markdownTargetsForFile(stubFile).some((target) => {
    const targetPath = normalizeMarkdownTarget(target)
    if (!targetPath) return false
    return path.resolve(path.dirname(stubFile), targetPath) === targetFile
  })
}

function checkSourceRefs(files, artifactIndex) {
  const failures = []
  let checked = 0
  let virtualRefs = 0
  let externalSignalRefs = 0
  let knownGaps = 0

  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n')

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const inlineMatch = lines[lineIndex].match(sourceRefsInlinePattern)
      if (inlineMatch) {
        for (const ref of parseInlineRefs(inlineMatch[1])) {
          const verdict = classifyRef(ref, artifactIndex)
          if (verdict === 'resolved') checked += 1
          else if (verdict === 'virtual') virtualRefs += 1
          else if (verdict === 'external-signal') externalSignalRefs += 1
          else if (verdict === 'known-gap') knownGaps += 1
          else failures.push({ file, line: lineIndex + 1, ref })
        }
        continue
      }

      const blockMatch = lines[lineIndex].match(sourceRefsBlockPattern)
      if (!blockMatch) continue

      const sourceIndent = indentation(lines[lineIndex])
      for (let refLine = lineIndex + 1; refLine < lines.length; refLine += 1) {
        const value = lines[refLine]
        if (value.trim().length === 0) continue

        const listMatch = value.match(listItemPattern)
        if (!listMatch) break
        if (indentation(value) <= sourceIndent) break

        const ref = cleanRef(listMatch[2])
        if (!ref || !artifactIdPattern.test(ref)) continue

        const verdict = classifyRef(ref, artifactIndex)
        if (verdict === 'resolved') checked += 1
        else if (verdict === 'virtual') virtualRefs += 1
        else if (verdict === 'external-signal') externalSignalRefs += 1
        else if (verdict === 'known-gap') knownGaps += 1
        else failures.push({ file, line: refLine + 1, ref })
      }
    }
  }

  return { checked, externalSignalRefs, failures, knownGaps, virtualRefs }
}

function classifyRef(ref, artifactIndex) {
  if (artifactIndex.has(ref)) return 'resolved'
  if (virtualCompilerPrefixes.has(ref.split('-')[0])) return 'virtual'
  if (externalBootstrapSignals.has(ref)) return 'external-signal'
  if (knownLineageGaps.has(ref)) return 'known-gap'
  return 'unresolved'
}

function parseInlineRefs(value) {
  if (value.trim().length === 0) return []
  return value
    .split(',')
    .map((entry) => cleanRef(entry))
    .filter((entry) => entry && artifactIdPattern.test(entry))
}

function cleanRef(value) {
  return value
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .replace(/\s+#.*$/, '')
    .replace(/,$/, '')
}

function normalizeMarkdownTarget(target) {
  const withoutTitle = target.match(/^<([^>]+)>$/)?.[1] ?? target.split(/\s+["'][^"']*["']\s*$/)[0]
  const withoutAnchor = withoutTitle.split('#')[0]
  if (!withoutAnchor) return ''
  try {
    return decodeURIComponent(withoutAnchor)
  } catch {
    return withoutAnchor
  }
}

function isExternalLink(target) {
  return /^(https?:|mailto:|tel:|ftp:|data:|#)/i.test(target)
}

function markdownTargetsForFile(file) {
  const targets = []
  const lines = readFileSync(file, 'utf8').split('\n')

  for (const line of lines) {
    let match
    const stripped = stripInlineCode(line)
    while ((match = markdownLinkPattern.exec(stripped)) !== null) {
      targets.push(match[2].trim())
    }
  }

  return targets
}

function stripInlineCode(value) {
  return value.replace(/`[^`]*`/g, '')
}

function indentation(value) {
  return value.match(/^\s*/)?.[0].length ?? 0
}

function relative(file) {
  return path.relative(root, file)
}

function isInsidePath(file, directory) {
  const rel = path.relative(directory, file)
  return rel.length > 0 && !rel.startsWith('..') && !path.isAbsolute(rel)
}

function formatLocation(file, line) {
  return `${relative(file)}:${line}`
}
