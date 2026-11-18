// Test runner settings. Tests live in tests/ and run with `pnpm test`.
// They never read .env: each test sets the env vars it needs, so results don't
// depend on which API keys this machine has.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // The same "@/…" import alias as tsconfig.json.
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    setupFiles: ["tests/setup.ts"],
    testTimeout: 20_000,
  },
});
