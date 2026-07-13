import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The SPA calls /api/* and Vite forwards to the NestJS API in dev, so the same
// relative paths work in production when the SPA is served behind the API.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET ?? 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
