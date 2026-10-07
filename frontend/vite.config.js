/**
 * Build settings. No `base`: Vercel serves from the domain root, and relative asset URLs
 * would break on nested routes.
 */

import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  // `bun run dev:api` serves the API over synthetic data on this port.
  server: { proxy: { '/api': 'http://localhost:3001' } },
  build: {
    // ECharts is most of the bundle and changes far less often than the pages do, so it
    // is split out to keep it cached across deploys.
    rollupOptions: {
      output: {
        manualChunks: {
          echarts: ['echarts', 'echarts-wordcloud'],
        },
      },
    },
  },
});
