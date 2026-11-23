import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./src/test/global-setup.ts'],
    // Database test files share one test database.
    fileParallelism: false,
  },
});
