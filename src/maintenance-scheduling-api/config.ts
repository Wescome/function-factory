/**
 * Configuration for integrating with external maintenance scheduling systems.
 * Defines connection parameters, authentication, and resilience policies.
 */

export interface MaintenanceSchedulingConnectionConfig {
  /** Base URL of the maintenance scheduling system API */
  baseUrl: string;

  /** API authentication key (required when authType is 'api-key') */
  apiKey?: string;

  /** Authentication mechanism used by the scheduling system */
  authType: 'bearer' | 'api-key' | 'basic' | 'none';

  /** Request timeout in milliseconds */
  timeoutMs: number;

  /** Retry policy for transient failures */
  retryPolicy?: RetryPolicy;

  /** Optional webhook endpoint for receiving async schedule updates */
  webhookEndpoint?: string;
}

export interface RetryPolicy {
  /** Maximum number of retry attempts */
  maxRetries: number;

  /** Multiplier for exponential backoff (e.g., 2 doubles the delay each retry) */
  backoffMultiplier: number;

  /** Initial delay before the first retry attempt */
  initialDelayMs: number;
}
