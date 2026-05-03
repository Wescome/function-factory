import { ORLRecord, ORLPhase, AnalysisResult, DegradationFinding, TrendAnalysis, RepairSequence } from './types';

export const DEFAULT_DEGRADATION_THRESHOLD = 5;

export function groupByWorkGraph(records: readonly ORLRecord[]): Map<string, RepairSequence> {
  const map = new Map<string, { repairs: ORLRecord[]; observations: ORLRecord[]; learnings: ORLRecord[] }>();

  for (const record of records) {
    if (!map.has(record.workGraphId)) {
      map.set(record.workGraphId, { repairs: [], observations: [], learnings: [] });
    }
    const entry = map.get(record.workGraphId)!;
    if (record.phase === 'repair') entry.repairs.push(record);
    else if (record.phase === 'observe') entry.observations.push(record);
    else if (record.phase === 'learn') entry.learnings.push(record);
  }

  const result = new Map<string, RepairSequence>();
  for (const [workGraphId, phases] of map) {
    result.set(workGraphId, {
      workGraphId,
      repairs: phases.repairs.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime()),
      observations: phases.observations.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime()),
      learnings: phases.learnings.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime()),
    });
  }
  return result;
}

export function detectDegradation(
  sequence: RepairSequence,
  threshold = DEFAULT_DEGRADATION_THRESHOLD,
): DegradationFinding {
  const repairs = sequence.repairs;
  const count = repairs.length;
  const isDegraded = count >= threshold;

  let timeSpanMs = 0;
  if (repairs.length > 1) {
    const first = repairs[0].timestamp.getTime();
    const last = repairs[repairs.length - 1].timestamp.getTime();
    timeSpanMs = last - first;
  }

  const recommendedAction = isDegraded
    ? `Systemic degradation detected for ${sequence.workGraphId}. Initiate deep root-cause analysis and architectural review.`
    : `Repair volume within normal parameters for ${sequence.workGraphId}.`;

  return {
    workGraphId: sequence.workGraphId,
    repairCount: count,
    threshold,
    isDegraded,
    timeSpanMs,
    recommendedAction,
  };
}

export function analyzeTrends(records: readonly ORLRecord[]): TrendAnalysis {
  const phaseDistribution: Record<ORLPhase, number> = { observe: 0, repair: 0, learn: 0 };

  for (const r of records) {
    phaseDistribution[r.phase]++;
  }

  const timestamps = records.map((r) => r.timestamp.getTime()).sort((a, b) => a - b);
  const durationMs = timestamps.length > 1 ? timestamps[timestamps.length - 1] - timestamps[0] : 0;
  const repairCount = phaseDistribution.repair;
  const durationDays = durationMs / (1000 * 60 * 60 * 24);
  const repairFrequency = durationDays > 0 ? repairCount / durationDays : 0;

  const loopGroups = new Map<string, { observe?: number; learn?: number }>();
  for (const r of records) {
    if (!loopGroups.has(r.loopId)) loopGroups.set(r.loopId, {});
    const g = loopGroups.get(r.loopId)!;
    const t = r.timestamp.getTime();
    if (r.phase === 'observe' && (g.observe === undefined || t < g.observe)) g.observe = t;
    if (r.phase === 'learn' && (g.learn === undefined || t > g.learn)) g.learn = t;
  }

  let totalCycleMs = 0;
  let completedCycles = 0;
  for (const g of loopGroups.values()) {
    if (g.observe !== undefined && g.learn !== undefined) {
      totalCycleMs += g.learn - g.observe;
      completedCycles++;
    }
  }

  const averageCycleTimeMs = completedCycles > 0 ? totalCycleMs / completedCycles : 0;

  return {
    phaseDistribution,
    averageCycleTimeMs,
    repairFrequency,
  };
}

export function analyzeSystemicIssues(
  records: readonly ORLRecord[],
  degradationThreshold = DEFAULT_DEGRADATION_THRESHOLD,
): AnalysisResult {
  const grouped = groupByWorkGraph(records);
  const findings: DegradationFinding[] = [];
  const systemicIssues: string[] = [];

  for (const sequence of grouped.values()) {
    const finding = detectDegradation(sequence, degradationThreshold);
    findings.push(finding);
    if (finding.isDegraded) {
      systemicIssues.push(finding.recommendedAction);
    }
  }

  const trends = analyzeTrends(records);

  return {
    findings,
    trends,
    systemicIssues,
  };
}
