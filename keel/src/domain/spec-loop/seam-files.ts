/**
 * spec-loop/seam-files.ts — PLAYBOOK-KEEL-SLICE-FILES-001 (C1b, Track 3,
 * INV-SLICE-SEAM-FLOOR): the file-overlap half of the composition seam,
 * mirroring `dag.ts`'s own shape and discipline — a pure, whole-batch check
 * over already-DISCOVERED data (Track 2's per-child written-file sets),
 * never itself touching a Workspace or any I/O. Two children that touched
 * the SAME file are an overlap; an unresolved overlap must not compose
 * (the floor's own guarantee). Sequenced-merge resolution and richer
 * auto-sequencing are named fast-follows, not built here — this file only
 * detects and reports.
 */
export interface ChildFileSet {
  /** A stable label for this child in the report — servesClause when
   *  present (the common case; every C1/C2-derived child has one), the
   *  child's own runId as a fallback for a row that predates servesClause. */
  readonly id: string;
  readonly writtenFiles: readonly string[];
}

export interface FileOverlap {
  readonly file: string;
  /** Every child (by `id`, sorted) that touched this file — at least 2. */
  readonly children: readonly string[];
}

export interface FileOverlapReport {
  /** True iff no file was touched by more than one child in this batch. */
  readonly ok: boolean;
  readonly overlaps: readonly FileOverlap[];
}

/**
 * The whole-batch check `compose()` runs alongside the existing result-
 * composition logic, over the SAME children `join()` already gathered —
 * BEFORE any of them merges. Empty (no child wrote anything, or every
 * written file is unique to one child) is trivially ok.
 */
export function checkFileOverlap(children: readonly ChildFileSet[]): FileOverlapReport {
  const byFile = new Map<string, Set<string>>();
  for (const c of children) {
    for (const f of c.writtenFiles) {
      if (!byFile.has(f)) byFile.set(f, new Set());
      byFile.get(f)!.add(c.id);
    }
  }
  const overlaps: FileOverlap[] = [];
  for (const [file, ids] of byFile) {
    if (ids.size > 1) overlaps.push({ file, children: [...ids].sort() });
  }
  overlaps.sort((a, b) => a.file.localeCompare(b.file));
  return { ok: overlaps.length === 0, overlaps };
}
