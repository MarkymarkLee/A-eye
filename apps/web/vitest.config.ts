import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@a-eye\/mcp\/(.*)$/,
        replacement: `${fileURLToPath(new URL("../../packages/mcp/src/", import.meta.url))}$1`,
      },
      { find: "@", replacement: fileURLToPath(new URL(".", import.meta.url)) },
    ],
  },
  test: { include: ["lib/**/*.test.ts", "app/**/*.test.ts"] },
});
