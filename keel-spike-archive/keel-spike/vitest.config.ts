import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";
// VERIFY: defineWorkersConfig export + poolOptions shape on your installed version.
export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.jsonc" },
        // miniflare: { compatibilityFlags: ["nodejs_compat"] }, // VERIFY if needed
      },
    },
  },
});
