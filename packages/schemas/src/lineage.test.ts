import { describe, it, expect } from "vitest"
import { ArtifactId } from "./lineage.js"

describe("ArtifactId regex — CONTRACT prefix", () => {
  it("accepts CONTRACT-META-FOO", () => {
    expect(ArtifactId.safeParse("CONTRACT-META-FOO").success).toBe(true)
  })

  it("accepts CONTRACT-FOO-BAR-01", () => {
    expect(ArtifactId.safeParse("CONTRACT-FOO-BAR-01").success).toBe(true)
  })

  it("rejects CONTRAC-FOO (prefix substring must not match)", () => {
    expect(ArtifactId.safeParse("CONTRAC-FOO").success).toBe(false)
  })

  it("rejects CONTRACT- alone (body required)", () => {
    expect(ArtifactId.safeParse("CONTRACT-").success).toBe(false)
  })

  it("rejects CONTRACT-foo (lowercase body rejected, mirroring existing rule)", () => {
    expect(ArtifactId.safeParse("CONTRACT-foo").success).toBe(false)
    // Sanity: same rule applies to a known existing prefix
    expect(ArtifactId.safeParse("ATOM-foo").success).toBe(false)
  })
})

describe("ArtifactId regex — CTR prefix", () => {
  it("accepts CTR-META-FOO", () => {
    expect(ArtifactId.safeParse("CTR-META-FOO").success).toBe(true)
  })

  it("accepts CTR-FOO-BAR-01", () => {
    expect(ArtifactId.safeParse("CTR-FOO-BAR-01").success).toBe(true)
  })

  it("rejects CT-FOO (prefix truncation)", () => {
    expect(ArtifactId.safeParse("CT-FOO").success).toBe(false)
  })

  it("rejects CTR- alone (body required)", () => {
    expect(ArtifactId.safeParse("CTR-").success).toBe(false)
  })
})

describe("ArtifactId regex — existing prefixes regression", () => {
  it("still accepts PRS-FOO", () => {
    expect(ArtifactId.safeParse("PRS-FOO").success).toBe(true)
  })

  it("still accepts SIG-FOO", () => {
    expect(ArtifactId.safeParse("SIG-FOO").success).toBe(true)
  })

  it("still accepts TRJ-FOO", () => {
    expect(ArtifactId.safeParse("TRJ-FOO").success).toBe(true)
  })

  it("still accepts CONTRACT-FOO post-CTR-addition", () => {
    expect(ArtifactId.safeParse("CONTRACT-FOO").success).toBe(true)
  })

  it("still accepts DEL-FOO post-CTR-addition", () => {
    expect(ArtifactId.safeParse("DEL-FOO").success).toBe(true)
  })
})
