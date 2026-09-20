/**
 * Build settings.
 *
 * There is deliberately no `base` here. The previous value, `base: './'`, existed because
 * GitHub Pages served this from a repository sub-path, where absolute asset URLs resolve
 * against the wrong root and the page loads blank with no error worth reading. Vercel
 * serves from the domain root, so the default absolute base is correct — and relative
 * asset URLs would break on any nested route the router serves.
 *
 * `api/` is not mentioned here. Vercel builds those functions separately and nothing under
 * `src/` imports them, so Vite never sees them.
 */

import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
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
