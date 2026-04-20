export type PackageStatus = "implemented" | "stub" | "missing"

export interface RepoInventory {
  readonly packages: Record<string, PackageStatus>
  readonly schemas: readonly string[]
  readonly artifactCounts: Readonly<Record<string, number>>
  readonly runners: readonly string[]
  readonly tests: Readonly<Record<string, number>>
  readonly notes?: readonly string[]
}
