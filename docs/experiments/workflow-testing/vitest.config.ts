import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 120000, // 2 minutes per test (workflows can be slow)
    hookTimeout: 30000,
    globals: true,
    include: ["tests/**/*.test.ts"],
    reporters: ["verbose"],
    // Collect timing data
    benchmark: {
      include: ["tests/**/*.bench.ts"],
    },
  },
});
