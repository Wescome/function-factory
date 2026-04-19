import { describe, it, expect } from "vitest"
import type { ArtifactId } from "./lineage.js"
import {
  CommitClassification,
  CommitTriageReport,
  ConventionalCommitType,
} from "./commit-triage.js"

const baseClassification = {
  sha: "abc1234",
  message_subject: "feat(auth): add SSO",
  classification: "feat" as const,
  scope: "auth",
  breaking_change: false,
  violations: [],
}

const baseReport = {
  id: "CTR-META-FOO-2026-04-19T00-00-00-000Z" as ArtifactId,
  source_refs: ["FP-META-FOO" as ArtifactId],
  explicitness: "explicit" as const,
  rationale: "test",
  range_from_sha: "abc1234",
  range_to_sha: "def5678",
  range_input: "HEAD~30..HEAD",
  commits: [baseClassification],
  summary: {
    total_commits: 1,
    counts_by_classification: { feat: 1 },
    commits_with_violations: 0,
  },
  status: "pass" as const,
}

describe("ConventionalCommitType", () => {
  it("parses each of the 12 enum values", () => {
    for (const v of [
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
    ]) {
      expect(ConventionalCommitType.safeParse(v).success).toBe(true)
    }
  })

  it("rejects FEAT (case-sensitive)", () => {
    expect(ConventionalCommitType.safeParse("FEAT").success).toBe(false)
  })
})

describe("CommitClassification", () => {
  it("accepts a minimal valid classification", () => {
    expect(CommitClassification.safeParse(baseClassification).success).toBe(true)
  })

  it("rejects malformed SHA (too short)", () => {
    expect(
      CommitClassification.safeParse({ ...baseClassification, sha: "abc" }).success
    ).toBe(false)
  })

  it("rejects malformed SHA (non-hex chars)", () => {
    expect(
      CommitClassification.safeParse({ ...baseClassification, sha: "GHIJKLM" })
        .success
    ).toBe(false)
  })
})

describe("CommitTriageReport", () => {
  it("accepts a minimal valid report", () => {
    expect(CommitTriageReport.safeParse(baseReport).success).toBe(true)
  })

  it("rejects report whose id does not start with CTR-", () => {
    const bad = {
      ...baseReport,
      id: "CR-NOT-A-TRIAGE-REPORT" as ArtifactId,
    }
    expect(CommitTriageReport.safeParse(bad).success).toBe(false)
  })

  it("accepts a report with violations_detected status", () => {
    const withViolations = {
      ...baseReport,
      status: "violations_detected" as const,
      commits: [
        {
          ...baseClassification,
          violations: ["feat commit missing scope"],
        },
      ],
      summary: {
        total_commits: 1,
        counts_by_classification: { feat: 1 },
        commits_with_violations: 1,
      },
    }
    expect(CommitTriageReport.safeParse(withViolations).success).toBe(true)
  })
})
