import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    exclude: ["dist/**", "node_modules/**"],
    fileParallelism: false,
    maxWorkers: 1,
    coverage: {
      reporter: ["text", "html"],
    },
  },
});
