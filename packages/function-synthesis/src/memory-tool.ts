/**
 * memory_write typed tool interface.
 *
 * Every memory write during synthesis is a typed tool call through this
 * interface. No memory mutation occurs outside it.
 *
 * AC 19
 */

import { MemoryWriteRecord } from "./types.js"

// ─── Memory Write Collector ───────────────────────────────────────────

export class MemoryWriteCollector {
  private readonly records: MemoryWriteRecord[] = []

  /**
   * Typed memory_write tool call.
   * All writes go through this interface for auditability.
   */
  memoryWrite(
    layer: string,
    key: string,
    content: string,
    sourceRefs: readonly string[],
  ): MemoryWriteRecord {
    const record = MemoryWriteRecord.parse({
      layer,
      key,
      content,
      sourceRefs: [...sourceRefs],
      timestamp: new Date().toISOString(),
    })
    this.records.push(record)
    return record
  }

  /**
   * Get all recorded memory writes for audit.
   */
  getRecords(): readonly MemoryWriteRecord[] {
    return [...this.records]
  }

  /**
   * Check that all records have non-empty source_refs (AC 19 test).
   */
  allHaveSourceRefs(): boolean {
    return this.records.every((r) => r.sourceRefs.length > 0)
  }
}
