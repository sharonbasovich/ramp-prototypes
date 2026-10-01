import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Static hosting path for the suite's GitHub Pages deployment. The local
// server also serves the same dist output under this prefix.
export default defineConfig({
  base: '/ramp-prototypes/budget-brawl/',
  plugins: [react()],
});
