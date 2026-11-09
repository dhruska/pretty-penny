import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // API test files share one database and clear it before each test.
    fileParallelism: false,
  },
});
