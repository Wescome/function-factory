export type ORLPhase = 'observe' | 'repair' | 'learn';

export interface ORLRecord {
  readonly id: string;
  readonly workGraphId: string;
  readonly loopId: string;
  readonly phase: ORLPhase;
  readonly timestamp: Date;
  readonly description?: string;
  readonly repairType?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface RepairSequence {
  readonly workGraphId: string;
  readonly repairs: readonly ORLRecord[];
  readonly observations: readonly ORLRecord[];
  readonly learnings: readonly ORLRecord[];
}

export interface DegradationFinding {
  readonly workGraphId: string;
  readonly repairCount: number;
  readonly threshold: number;
  readonly isDegraded: boolean;
  readonly timeSpanMs: number;
  readonly recommendedAction: string;
}

export interface TrendAnalysis {
  readonly phaseDistribution: Record<ORLPhase, number>;
  readonly averageCycleTimeMs: number;
  readonly repairFrequency: number;
}

export interface AnalysisResult {
  readonly findings: DegradationFinding[];
  readonly trends: TrendAnalysis;
  readonly systemicIssues: string[];
}
