// gdk-ts/src/pii.ts — PII filter interface and default implementation
// Per SDD-GDK §9.4: PII stripped before kernel.

/**
 * PIIFilter strips PII from context data before it reaches the kernel.
 * Implementations replace sensitive values with reference tokens.
 */
export interface PIIFilter {
  strip(data: Record<string, unknown>): Record<string, unknown>;
}

/**
 * NoOpPIIFilter is a pass-through filter for development and testing.
 * Production assemblies must supply a real PIIFilter implementation.
 */
export class NoOpPIIFilter implements PIIFilter {
  strip(data: Record<string, unknown>): Record<string, unknown> {
    return data;
  }
}
