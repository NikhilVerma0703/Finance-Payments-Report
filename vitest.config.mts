import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      // fileURLToPath rather than `.pathname`: the URL's pathname keeps spaces
      // as %20 (and a leading slash before the drive on Windows), so the alias
      // pointed nowhere when the project sat in a folder with spaces in its name.
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` throws outside a React Server Component; the modules it
      // guards are plain functions under test here.
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
});
