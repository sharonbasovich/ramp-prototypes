import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base so the same dist/ works on GitHub Pages (any path prefix)
// and from the plain Node static server in server/serve.mjs.
export default defineConfig({
  base: './',
  plugins: [react()],
});
