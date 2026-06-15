/**
 * @module disposition-parser
 *
 * Structured DISPOSITION: comment parser — no LLM, pure string parsing.
 *
 * Grammar:
 *   DISPOSITION: <verb> [args...]
 *
 * Verb forms:
 *   DISPOSITION: resume [workGraphId] [workGraphVersion]
 *   DISPOSITION: commission <workGraphId> <workGraphVersion> <repoId>
 *   DISPOSITION: patch <patchId> <repoId1> [repoId2 ...]
 *   DISPOSITION: pipeline-config <configChangeId> <repoId1> [repoId2 ...]
 *   DISPOSITION: override <directive> [targetRepoId]
 *     directive: force-suspend | force-resume | emergency-patch
 *   DISPOSITION: reject [reason...]
 *
 * Comments may have the DISPOSITION: line anywhere in the body — it does not
 * need to be at the start. Only the first DISPOSITION: line is processed.
 */

import type { ParsedDisposition, DispositionVerb } from './types.js'
import type { OverrideDirective } from '@factory/schemas/weops-signals'

// ─── Parser ───────────────────────────────────────────────────────────────────

const DISPOSITION_PREFIX = 'DISPOSITION:'
const VALID_VERBS: ReadonlySet<string> = new Set<string>([
  'resume',
  'commission',
  'patch',
  'pipeline-config',
  'override',
  'reject',
])
const VALID_OVERRIDE_DIRECTIVES: ReadonlySet<string> = new Set<string>([
  'force-suspend',
  'force-resume',
  'emergency-patch',
])

export interface ParseResult {
  ok: true
  disposition: ParsedDisposition
}

export interface ParseFailure {
  ok: false
  reason: string
}

export type ParseDispositionResult = ParseResult | ParseFailure

/**
 * Attempts to parse a structured DISPOSITION comment from a Linear comment body.
 *
 * Returns ok=false if the comment does not contain a DISPOSITION: line, or if
 * the DISPOSITION: line is malformed.
 */
export function parseDispositionComment(body: string): ParseDispositionResult {
  // Find first DISPOSITION: line (case-sensitive).
  const lines = body.split('\n')
  const dispositionLine = lines.find((l) => l.trimStart().startsWith(DISPOSITION_PREFIX))

  if (dispositionLine === undefined) {
    return { ok: false, reason: 'no DISPOSITION: line found' }
  }

  // Extract the content after "DISPOSITION:".
  const afterPrefix = dispositionLine.slice(
    dispositionLine.indexOf(DISPOSITION_PREFIX) + DISPOSITION_PREFIX.length,
  ).trim()

  if (!afterPrefix) {
    return { ok: false, reason: 'DISPOSITION: line is empty' }
  }

  const tokens = afterPrefix.split(/\s+/).filter(Boolean)
  const verb = tokens[0]

  if (!verb || !VALID_VERBS.has(verb)) {
    return {
      ok: false,
      reason: `unknown disposition verb: '${verb ?? ''}'. Valid: ${Array.from(VALID_VERBS).join(', ')}`,
    }
  }

  const rawArgs = tokens.slice(1)
  const typedVerb = verb as DispositionVerb

  switch (typedVerb) {
    case 'resume': {
      const [workGraphId, workGraphVersion] = rawArgs
      return {
        ok: true,
        disposition: {
          verb: typedVerb,
          ...(workGraphId !== undefined ? { workGraphId } : {}),
          ...(workGraphVersion !== undefined ? { workGraphVersion } : {}),
          rawArgs,
        },
      }
    }

    case 'commission': {
      const [workGraphId, workGraphVersion] = rawArgs
      if (!workGraphId || !workGraphVersion) {
        return {
          ok: false,
          reason: 'commission requires: <workGraphId> <workGraphVersion>',
        }
      }
      return {
        ok: true,
        disposition: {
          verb: typedVerb,
          workGraphId,
          workGraphVersion,
          rawArgs,
        },
      }
    }

    case 'patch': {
      const [patchId, ...repoIds] = rawArgs
      if (!patchId || repoIds.length === 0) {
        return {
          ok: false,
          reason: 'patch requires: <patchId> <repoId1> [repoId2 ...]',
        }
      }
      return {
        ok: true,
        disposition: {
          verb: typedVerb,
          patchId,
          affectedRepoIds: repoIds,
          rawArgs,
        },
      }
    }

    case 'pipeline-config': {
      const [configChangeId, ...repoIds] = rawArgs
      if (!configChangeId || repoIds.length === 0) {
        return {
          ok: false,
          reason: 'pipeline-config requires: <configChangeId> <repoId1> [repoId2 ...]',
        }
      }
      return {
        ok: true,
        disposition: {
          verb: typedVerb,
          configChangeId,
          affectedRepoIds: repoIds,
          rawArgs,
        },
      }
    }

    case 'override': {
      const [directive, targetRepoId] = rawArgs
      if (!directive || !VALID_OVERRIDE_DIRECTIVES.has(directive)) {
        return {
          ok: false,
          reason: `override requires directive: ${Array.from(VALID_OVERRIDE_DIRECTIVES).join(' | ')}`,
        }
      }
      return {
        ok: true,
        disposition: {
          verb: typedVerb,
          overrideDirective: directive as OverrideDirective,
          ...(targetRepoId !== undefined ? { targetRepoId } : {}),
          rawArgs,
        },
      }
    }

    case 'reject': {
      return {
        ok: true,
        disposition: {
          verb: typedVerb,
          rawArgs,
        },
      }
    }
  }
}

/**
 * Returns true if a comment body contains a DISPOSITION: line.
 * Cheap check before full parse.
 */
export function hasDispositionLine(body: string): boolean {
  return body.includes(DISPOSITION_PREFIX)
}
