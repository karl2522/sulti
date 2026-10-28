import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@sulti/core": here("./packages/core/src/index.ts"),
      "@sulti/protocol": here("./packages/protocol/src/index.ts"),
    },
  },
  test: {
    include: ["packages/**/src/**/*.test.ts", "apps/**/src/**/*.test.{ts,tsx}", "test/**/*.test.ts", "tools/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    testTimeout: 15000,
  },
});
