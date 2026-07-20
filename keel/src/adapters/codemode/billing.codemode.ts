import { CodemodeConnector } from "@cloudflare/codemode";
import type { CallRecorder } from "./call-recorder";

/**
 * A mock billing connector whose live response shape differs from the obvious
 * guess: getTier returns { tier: "pro" } (a string enum), NOT a number. This is
 * the stale-assumption fixture (connector named `billing`, NOT `tier`, so it
 * never collides with the acceptance vocabulary and cannot be shadowed) — a naive model assumes a number and must learn
 * the real shape from the recorded response (E-C).
 */
export class BillingConnector extends CodemodeConnector<unknown> {
  constructor(ctx: unknown, env: unknown, private readonly rec: CallRecorder) {
    super(ctx as never, env as never);
  }
  override name() { return "billing"; }
  override tools() {
    const rec = this.rec;
    return {
      getTier: {
        description: "Get a customer's current plan tier.",
        execute: (args: unknown) => {
          const response = { tier: "pro" }; // string enum, not a number
          rec.record("billing", "getTier", args, response);
          return response;
        },
      },
    };
  }
}
