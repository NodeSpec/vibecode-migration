import { fileURLToPath } from 'node:url'
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
        // The function reads netlify/functions/_lib/build-info.json, which `postbuild` writes and git
        // ignores. Tests read a fixed fixture instead, so they give the same answer before and after a build.
        resolve: {
          alias: [
            {
              find: /^.*\/_lib\/build-info\.json$/,
              replacement: fileURLToPath(new URL('./netlify/functions/__tests__/build-info.fixture.json', import.meta.url)),
            },
          ],
        },
        test: {
          name: 'functions',
          environment: 'node',
          include: ['netlify/functions/__tests__/**/*.test.ts'],
        },
      },
    ],
  },
})
