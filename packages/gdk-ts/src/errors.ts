// gdk-ts/src/errors.ts — Error hierarchy for GDK-TS
// Per SDD-GDK §4.3.3. All subclasses must be instanceof-checkable (AT-GDK-TS-09).

/**
 * GovernanceError is the base error type for all GDK governance errors.
 * Every governance error carries an audit trail ID and work order ID for traceability.
 * Code uses WAC condition codes (WAC_A, WAC_P, WAC_C, WAC_R) or GDK-specific codes (GDK_*).
 */
export class GovernanceError extends Error {
  readonly code: string;
  readonly auditTrailId: string;
  readonly workOrderId: string;
  readonly nextSteps: string[];

  constructor(params: {
    code: string;
    message: string;
    auditTrailId?: string;
    workOrderId?: string;
    nextSteps?: string[];
  }) {
    super(params.message);
    this.name = "GovernanceError";
    this.code = params.code;
    this.auditTrailId = params.auditTrailId ?? "";
    this.workOrderId = params.workOrderId ?? "";
    this.nextSteps = params.nextSteps ?? [];

    // Fix prototype chain for instanceof checks (AT-GDK-TS-09)
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * AuthorizationError indicates the kernel denied the action (WAC-A failure).
 */
export class AuthorizationError extends GovernanceError {
  readonly requiredRole: string;
  readonly actualRole: string;

  constructor(params: {
    code: string;
    message: string;
    auditTrailId?: string;
    workOrderId?: string;
    nextSteps?: string[];
    requiredRole?: string;
    actualRole?: string;
  }) {
    super(params);
    this.name = "AuthorizationError";
    this.requiredRole = params.requiredRole ?? "";
    this.actualRole = params.actualRole ?? "";
  }
}

/**
 * FidelityInsufficientError indicates data freshness requirements are not met.
 */
export class FidelityInsufficientError extends GovernanceError {
  readonly missingFields: string[];

  constructor(params: {
    code: string;
    message: string;
    auditTrailId?: string;
    workOrderId?: string;
    nextSteps?: string[];
    missingFields?: string[];
  }) {
    super(params);
    this.name = "FidelityInsufficientError";
    this.missingFields = params.missingFields ?? [];
  }
}

/**
 * EscalationTimeoutError indicates a T2 approval wait exceeded the configured timeout.
 */
export class EscalationTimeoutError extends GovernanceError {
  readonly escalationId: string;
  readonly escalatedTo: string;
  readonly timeoutDurationMs: number;

  constructor(params: {
    code: string;
    message: string;
    auditTrailId?: string;
    workOrderId?: string;
    nextSteps?: string[];
    escalationId?: string;
    escalatedTo?: string;
    timeoutDurationMs?: number;
  }) {
    super(params);
    this.name = "EscalationTimeoutError";
    this.escalationId = params.escalationId ?? "";
    this.escalatedTo = params.escalatedTo ?? "";
    this.timeoutDurationMs = params.timeoutDurationMs ?? 0;
  }
}

/**
 * PolicyViolationError indicates a policy rule was violated.
 */
export class PolicyViolationError extends GovernanceError {
  readonly policyId: string;
  readonly policyName: string;
  readonly violationDetails: string;

  constructor(params: {
    code: string;
    message: string;
    auditTrailId?: string;
    workOrderId?: string;
    nextSteps?: string[];
    policyId?: string;
    policyName?: string;
    violationDetails?: string;
  }) {
    super(params);
    this.name = "PolicyViolationError";
    this.policyId = params.policyId ?? "";
    this.policyName = params.policyName ?? "";
    this.violationDetails = params.violationDetails ?? "";
  }
}

/**
 * CircuitOpenError indicates the circuit breaker is OPEN and requests are fail-fast.
 * Per CONSOLE-10: Circuit breaker prevents cascading failures during kernel outages.
 */
export class CircuitOpenError extends GovernanceError {
  readonly circuitState: 'open';
  readonly recoveryTimeoutMs: number;
  readonly nextAttemptAt: Date;

  constructor(params: {
    message?: string;
    recoveryTimeoutMs: number;
    nextAttemptAt: Date;
    auditTrailId?: string;
    workOrderId?: string;
  }) {
    super({
      code: 'GDK_CIRCUIT_OPEN',
      message: params.message ?? 'Circuit breaker is OPEN - kernel unavailable',
      auditTrailId: params.auditTrailId,
      workOrderId: params.workOrderId,
      nextSteps: [
        'Wait for circuit recovery timeout to elapse',
        'Check kernel health status',
        'Consider degraded mode operation',
      ],
    });
    this.name = "CircuitOpenError";
    this.circuitState = 'open';
    this.recoveryTimeoutMs = params.recoveryTimeoutMs;
    this.nextAttemptAt = params.nextAttemptAt;

    // Fix prototype chain for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * RetryExhaustedError indicates all retry attempts have been exhausted.
 * Per CONSOLE-10: Retry with exponential backoff failed after max retries.
 */
export class RetryExhaustedError extends GovernanceError {
  readonly attempts: number;
  readonly lastError: Error;
  readonly totalDelayMs: number;

  constructor(params: {
    attempts: number;
    lastError: Error;
    totalDelayMs: number;
    auditTrailId?: string;
    workOrderId?: string;
  }) {
    super({
      code: 'GDK_RETRY_EXHAUSTED',
      message: `Retry exhausted after ${params.attempts} attempts: ${params.lastError.message}`,
      auditTrailId: params.auditTrailId,
      workOrderId: params.workOrderId,
      nextSteps: [
        'Check kernel availability',
        'Verify network connectivity',
        'Review transient error patterns',
      ],
    });
    this.name = "RetryExhaustedError";
    this.attempts = params.attempts;
    this.lastError = params.lastError;
    this.totalDelayMs = params.totalDelayMs;

    // Fix prototype chain for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
