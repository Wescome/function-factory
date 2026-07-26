import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
  // PLAYBOOK-KEEL-RUN-SUITE-001: @cloudflare/sandbox + @cloudflare/containers
  // add real import weight to every DO's cold path (confirmed: full-suite
  // gate runs measurably slower since wiring the real SANDBOX binding,
  // tipping an occasional test over the 5s default under full-suite pool
  // contention -- each one passes in well under 1s in isolation). Raised,
  // not removed: a genuinely hung test still fails, just not from added
  // container-package weight it has nothing to do with.
  test: { testTimeout: 10000 },
});
