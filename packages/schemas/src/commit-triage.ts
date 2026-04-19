/**
 * CommitTriageReport schema. First-class Factory artifact for the
 * v2 vertical (git-commit-triage). Every triage invocation produces
 * one CommitTriageReport regardless of whether any violations were
 * detected.
 *
 * See DECISIONS.md 2026-04-19 entries for v2 selection rationale
 * and the paired PR that added this schema + the CTR- ArtifactId
 * prefix.
 */

import { z } from "zod"
import { ArtifactId, Lineage } from "./lineage.js"

export const ConventionalCommitType = z.enum([
  "feat",
  "fix",
  "docs",
  "chore",
  "refactor",
  "test",
  "style",
  "perf",
  "ci",
  "build",
  "revert",
  "unknown",
])
export type ConventionalCommitType = z.infer<typeof ConventionalCommitType>

export const CommitClassification = z.object({
  sha: z.string().regex(/^[0-9a-f]{7,40}$/),
  message_subject: z.string(),
  classification: ConventionalCommitType,
  scope: z.string().nullable(),
  breaking_change: z.boolean(),
  violations: z.array(z.string()).default([]),
})
export type CommitClassification = z.infer<typeof CommitClassification>

export const CommitTriageReport = Lineage.extend({
  id: ArtifactId.refine(
    (s) => s.startsWith("CTR-"),
    "CommitTriageReport IDs must start with CTR-"
  ),
  range_from_sha: z.string().regex(/^[0-9a-f]{7,40}$/),
  range_to_sha: z.string().regex(/^[0-9a-f]{7,40}$/),
  range_input: z
    .string()
    .describe(
      "The original range argument before SHA resolution, e.g. HEAD~30..HEAD"
    ),
  commits: z.array(CommitClassification),
  summary: z.object({
    total_commits: z.number().int().nonnegative(),
    counts_by_classification: z.record(
      ConventionalCommitType,
      z.number().int().nonnegative()
    ),
    commits_with_violations: z.number().int().nonnegative(),
  }),
  status: z.enum(["pass", "violations_detected", "uncomputable"]),
})
export type CommitTriageReport = z.infer<typeof CommitTriageReport>
