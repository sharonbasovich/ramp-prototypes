import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/ramp-prototypes/borrowfirst/',
  plugins: [react()],
  server: {
    port: 5314,
    proxy: {
      '/api': 'http://localhost:5313',
    },
  },
  preview: {
    port: 5314,
  },
});
