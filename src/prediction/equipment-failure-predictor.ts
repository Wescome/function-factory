/**
 * Stub predictor for equipment failures.
 * Implements a deterministic strategy so that test assertions
 * against ground-truth data can verify precision thresholds.
 */
export interface FailurePrediction {
  equipmentId: string;
  predictedFailure: boolean;
  confidence: number;
}

export interface EquipmentFailurePredictor {
  predict(equipmentIds: string[]): Promise<FailurePrediction[]>;
}

export class StubEquipmentFailurePredictor implements EquipmentFailurePredictor {
  async predict(equipmentIds: string[]): Promise<FailurePrediction[]> {
    return equipmentIds.map((equipmentId, index) => ({
      equipmentId,
      // Deterministic stub: even-indexed items are predicted to fail
      predictedFailure: index % 2 === 0,
      confidence: 0.82,
    }));
  }
}
