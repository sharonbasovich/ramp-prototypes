import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Relative base keeps every asset URL relative, so the same build works on
// localhost, a file path, and GitHub Pages under /ramp-prototypes/cart-tetris/.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 5311, strictPort: true },
  preview: { port: 5311, strictPort: true },
  test: { environment: 'node' },
});
