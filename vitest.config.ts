import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

// Minimal Concierge test infrastructure. Node environment only — no
// jsdom/browser needed since these tests cover env/DB/orchestration logic,
// not UI rendering. Scoped to tests/ so this never picks up app source
// files as test files by accident.
export default defineConfig({
  resolve: {
    alias: {
      // "server-only" is a Next.js bundler-special import guard, not a
      // real package — stub it so src/lib/concierge/* (which import it
      // deliberately, matching the reference pattern elsewhere in this
      // workspace) can be loaded directly by Vitest.
      "server-only": resolve(__dirname, "./tests/setup/server-only-stub.ts"),
      // Mirror tsconfig.json's "@/*" -> "./src/*" path alias for Vitest,
      // which doesn't read tsconfig paths on its own.
      "@": resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./tests/setup/load-env.ts"],
    include: ["tests/**/*.test.ts"],
    testTimeout: 30000,
  },
});
