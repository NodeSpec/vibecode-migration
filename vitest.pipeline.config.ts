import { defineConfig } from 'vitest/config'

// The pipeline's own checks, kept apart from the app's `npm test` so they work
// whatever test runner the app uses. Run them with `npm run test:pipeline`.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'ci',
          environment: 'node',
          include: ['scripts/ci/__tests__/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'functions',
          environment: 'node',
          include: ['netlify/functions/__tests__/**/*.test.ts'],
        },
      },
    ],
  },
})
