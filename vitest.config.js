import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'fast',
          environment: 'jsdom',
          setupFiles: ['./tests/setup.js'],
          include: [
            'tests/unit/**/*.test.{js,ts}',
            'tests/integration/**/*.test.{js,ts}',
          ],
        },
      },
      {
        test: {
          name: 'e2e',
          environment: 'node',
          include: ['tests/e2e/**/*.test.{js,ts}'],
          fileParallelism: false,
          testTimeout: 60_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
