/**
 * Build settings.
 *
 * `base: './'` is the one setting that is not a default. GitHub Pages serves this from a
 * repository sub-path, so absolute asset URLs resolve against the wrong root and the page
 * loads blank with no error worth reading. Relative ones work from any prefix.
 */

import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  base: './',
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
