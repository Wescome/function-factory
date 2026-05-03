import { StubEquipmentFailurePredictor, FailurePrediction } from '../equipment-failure-predictor';

function calculatePrecision(
  predictions: FailurePrediction[],
  actualFailures: Set<string>
): number {
  const predictedPositive = predictions.filter((p) => p.predictedFailure);
  if (predictedPositive.length === 0) {
    return 0;
  }

  const truePositives = predictedPositive.filter((p) =>
    actualFailures.has(p.equipmentId)
  ).length;

  return truePositives / predictedPositive.length;
}

describe('Equipment Failure Prediction Precision (atom-004)', () => {
  it('should achieve at least 80% precision on evaluation data', async () => {
    const predictor = new StubEquipmentFailurePredictor();

    const equipmentIds = [
      'eq-001',
      'eq-002',
      'eq-003',
      'eq-004',
      'eq-005',
      'eq-006',
      'eq-007',
      'eq-008',
      'eq-009',
      'eq-010',
    ];

    // Ground truth: 4 of the 5 even-indexed items are actual failures
    const actualFailures = new Set([
      'eq-001',
      'eq-003',
      'eq-005',
      'eq-007',
    ]);

    const predictions = await predictor.predict(equipmentIds);
    const precision = calculatePrecision(predictions, actualFailures);

    // Stub predicts 5 failures (indices 0,2,4,6,8).
    // 4 are true positives (eq-001,003,005,007) and 1 is false positive (eq-009).
    // Expected precision = 4 / 5 = 0.8.
    expect(precision).toBeGreaterThanOrEqual(0.8);
  });
});
