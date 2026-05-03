import { describe, it, expect } from 'vitest';
import { analyzeSystemicIssues, groupByWorkGraph } from '../analyzer';
import type { ORLRecord } from '../types';

function makeRecord(
  id: string,
  workGraphId: string,
  phase: ORLRecord['phase'],
  offsetHours: number,
): ORLRecord {
  const base = new Date('2024-01-01T00:00:00Z').getTime();
  return {
    id,
    workGraphId,
    loopId: `loop-${workGraphId}`,
    phase,
    timestamp: new Date(base + offsetHours * 60 * 60 * 1000),
  };
}

describe('ORL Analysis Module', () => {
  it('identifies systemic degradation for WG-MOPZAFH9-QNQM with 5 repairs', () => {
    const records: ORLRecord[] = [
      ...Array.from({ length: 5 }, (_, i) =>
        makeRecord(`r${i}`, 'WG-MOPZAFH9-QNQM', 'repair', i),
      ),
      makeRecord('o1', 'WG-MOPZAFH9-QNQM', 'observe', 0),
      makeRecord('l1', 'WG-MOPZAFH9-QNQM', 'learn', 6),
    ];

    const result = analyzeSystemicIssues(records);
    const finding = result.findings.find((f) => f.workGraphId === 'WG-MOPZAFH9-QNQM');

    expect(finding).toBeDefined();
    expect(finding!.repairCount).toBe(5);
    expect(finding!.isDegraded).toBe(true);
    expect(result.systemicIssues).toContain(
      'Systemic degradation detected for WG-MOPZAFH9-QNQM. Initiate deep root-cause analysis and architectural review.',
    );
  });

  it('does not flag degradation when repairs are below threshold', () => {
    const records: ORLRecord[] = [
      makeRecord('r1', 'WG-STABLE-01', 'repair', 1),
      makeRecord('o1', 'WG-STABLE-01', 'observe', 0),
      makeRecord('l1', 'WG-STABLE-01', 'learn', 2),
    ];

    const result = analyzeSystemicIssues(records);
    const finding = result.findings.find((f) => f.workGraphId === 'WG-STABLE-01');

    expect(finding).toBeDefined();
    expect(finding!.repairCount).toBe(1);
    expect(finding!.isDegraded).toBe(false);
    expect(result.systemicIssues.length).toBe(0);
  });

  it('groups records by workGraphId and preserves phase separation', () => {
    const records: ORLRecord[] = [
      makeRecord('o1', 'WG-A', 'observe', 0),
      makeRecord('r1', 'WG-A', 'repair', 1),
      makeRecord('o2', 'WG-B', 'observe', 0),
      makeRecord('l1', 'WG-B', 'learn', 2),
    ];

    const grouped = groupByWorkGraph(records);
    expect(grouped.size).toBe(2);
    expect(grouped.get('WG-A')!.repairs.length).toBe(1);
    expect(grouped.get('WG-A')!.observations.length).toBe(1);
    expect(grouped.get('WG-B')!.learnings.length).toBe(1);
  });

  it('calculates trend metrics across all records', () => {
    const records: ORLRecord[] = [
      makeRecord('o1', 'WG-X', 'observe', 0),
      makeRecord('r1', 'WG-X', 'repair', 1),
      makeRecord('l1', 'WG-X', 'learn', 2),
      makeRecord('o2', 'WG-X', 'observe', 24),
      makeRecord('r2', 'WG-X', 'repair', 25),
      makeRecord('l2', 'WG-X', 'learn', 26),
    ];

    const result = analyzeSystemicIssues(records);
    expect(result.trends.phaseDistribution.observe).toBe(2);
    expect(result.trends.phaseDistribution.repair).toBe(2);
    expect(result.trends.phaseDistribution.learn).toBe(2);
    expect(result.trends.averageCycleTimeMs).toBeGreaterThan(0);
    expect(result.trends.repairFrequency).toBeGreaterThan(0);
  });
});
