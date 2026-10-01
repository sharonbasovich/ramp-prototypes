import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base so the same build works on GitHub Pages under
// /ramp-prototypes/pay-me-twice/ and behind the Node server on any path.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 5312,
    proxy: {
      // Dev convenience: `PORT=5392 npm run api` in another shell gives the
      // dev server a real backend. When absent the app honestly reports
      // browser-sandbox mode.
      '/api': 'http://127.0.0.1:5392',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
