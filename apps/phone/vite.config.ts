import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const companion = "http://127.0.0.1:7417";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@sulti/core": here("../../packages/core/src/index.ts") },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // The companion's CSP blocks inline scripts, so keep everything in files.
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": companion,
      "/ws": { target: companion, ws: true },
    },
  },
});
