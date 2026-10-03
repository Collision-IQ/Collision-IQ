import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "node",
    // Plain node-assert scripts (*.test.cjs, run by scripts/run-cjs-tests.cjs,
    // and displayText.test.js) have no vitest suite, so vitest reports each
    // as a failed file. zipSafety.test.cjs registers with vitest when VITEST
    // is set, so it stays in. .claude/ holds agent worktrees, copies of src/.
    exclude: [
      ...configDefaults.exclude,
      "**/!(zipSafety).test.cjs",
      "src/lib/ai/displayText.test.js",
      "**/.claude/**",
    ],
  },
});
