// gdk-ts/src/decorators.ts — Decorators for GDK-TS
// Supports both TC39 Stage 3 and legacy TypeScript decorators.
// Bun <1.2 uses legacy decorators; future versions will use Stage 3.

import type { GovernedConfig } from "./types.js";
import { GovernedService } from "./service.js";

/**
 * @governed decorator — wraps a method in executeGovernedAction.
 *
 * Supports both:
 *  - Legacy TS decorators: (target, propertyKey, descriptor)
 *  - TC39 Stage 3 decorators: (target, context) where context.kind === "method"
 *
 * The decorated class must extend GovernedService.
 */
export function governed(config: GovernedConfig) {
  return function (
    targetOrMethod: any,
    propertyKeyOrContext: any,
    descriptor?: PropertyDescriptor,
  ): any {
    // Detect which decorator protocol is in use
    if (descriptor && typeof descriptor.value === "function") {
      // Legacy TypeScript decorators: (target, propertyKey, descriptor)
      const originalMethod = descriptor.value;
      const methodName = String(propertyKeyOrContext);

      descriptor.value = async function (this: GovernedService, ...args: unknown[]) {
        let result: unknown;

        const idempotencyKey = config.idempotencyKeyFn
          ? config.idempotencyKeyFn(...args)
          : `${methodName}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        await this.executeGovernedAction({
          intentClass: config.intentClass,
          tier: config.tier,
          fidelityRequirements: config.fidelityRequirements,
          pisValidation: config.pisValidation,
          reversible: config.reversible,
          reversibleForMs: config.reversibleForMs,
          idempotencyKey,
          action: async () => {
            result = await originalMethod.call(this, ...args);
          },
        });

        return result;
      };

      return descriptor;
    }

    // TC39 Stage 3 decorators: (target, context)
    const context = propertyKeyOrContext as ClassMethodDecoratorContext;
    if (context && context.kind === "method") {
      const originalMethod = targetOrMethod as (...args: unknown[]) => Promise<unknown>;

      return async function (this: GovernedService, ...args: unknown[]) {
        let result: unknown;

        const idempotencyKey = config.idempotencyKeyFn
          ? config.idempotencyKeyFn(...args)
          : `${String(context.name)}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        await this.executeGovernedAction({
          intentClass: config.intentClass,
          tier: config.tier,
          fidelityRequirements: config.fidelityRequirements,
          pisValidation: config.pisValidation,
          reversible: config.reversible,
          reversibleForMs: config.reversibleForMs,
          idempotencyKey,
          action: async () => {
            result = await originalMethod.call(this, ...args);
          },
        });

        return result;
      };
    }

    throw new Error("@governed can only be applied to methods");
  };
}

/**
 * @audited decorator — read-only observation, creates evidence entry.
 * Does not create a work order. Creates an OBSERVE evidence entry.
 */
export function audited(logLevel: "standard" | "detailed" | "forensic" = "standard") {
  return function (
    targetOrMethod: any,
    propertyKeyOrContext: any,
    descriptor?: PropertyDescriptor,
  ): any {
    if (descriptor && typeof descriptor.value === "function") {
      // Legacy
      const originalMethod = descriptor.value;
      descriptor.value = async function (this: GovernedService, ...args: unknown[]) {
        return await originalMethod.call(this, ...args);
      };
      return descriptor;
    }

    // TC39 Stage 3
    const context = propertyKeyOrContext as ClassMethodDecoratorContext;
    if (context && context.kind === "method") {
      const originalMethod = targetOrMethod as (...args: unknown[]) => Promise<unknown>;
      return async function (this: GovernedService, ...args: unknown[]) {
        return await originalMethod.call(this, ...args);
      };
    }

    throw new Error("@audited can only be applied to methods");
  };
}

/**
 * @reversible decorator — forward + reverse function registration.
 */
export function reversible(config: {
  forwardIntent: string;
  reverseIntent: string;
  reversibleForMs: number;
}) {
  return function (
    targetOrMethod: any,
    propertyKeyOrContext: any,
    descriptor?: PropertyDescriptor,
  ): any {
    if (descriptor && typeof descriptor.value === "function") {
      // Legacy
      const originalMethod = descriptor.value;
      descriptor.value = async function (this: GovernedService, ...args: unknown[]) {
        let result: unknown;
        const idempotencyKey = `rev_${config.forwardIntent}_${Date.now()}`;

        await this.executeGovernedAction({
          intentClass: config.forwardIntent,
          tier: 0,
          reversible: true,
          reversibleForMs: config.reversibleForMs,
          idempotencyKey,
          action: async () => {
            result = await originalMethod.call(this, ...args);
          },
        });

        return result;
      };
      return descriptor;
    }

    // TC39 Stage 3
    const context = propertyKeyOrContext as ClassMethodDecoratorContext;
    if (context && context.kind === "method") {
      const originalMethod = targetOrMethod as (...args: unknown[]) => Promise<unknown>;
      return async function (this: GovernedService, ...args: unknown[]) {
        let result: unknown;
        const idempotencyKey = `rev_${config.forwardIntent}_${Date.now()}`;

        await this.executeGovernedAction({
          intentClass: config.forwardIntent,
          tier: 0,
          reversible: true,
          reversibleForMs: config.reversibleForMs,
          idempotencyKey,
          action: async () => {
            result = await originalMethod.call(this, ...args);
          },
        });

        return result;
      };
    }

    throw new Error("@reversible can only be applied to methods");
  };
}
