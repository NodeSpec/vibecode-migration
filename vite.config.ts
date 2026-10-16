import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Source maps would publish the original source next to the site.
    sourcemap: false,
  },
  test: {
    // The app's own tests only. The pipeline's checks run separately with
    // `npm run test:pipeline` (vitest.pipeline.config.ts), whatever runner the app uses.
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
