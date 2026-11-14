import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests for the analytics modules (factor ratings, gating, chart
// rendering). Client components render in jsdom; the "@/…" alias mirrors
// tsconfig paths.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  },
  esbuild: {
    jsx: "automatic"
  },
  test: {
    environment: "jsdom"
  }
});
