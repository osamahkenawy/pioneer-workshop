import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server proxies API + uploaded files + websockets to the backend.
// DEV_PORT / DEV_API override the defaults when another project on the same
// machine already uses 5173 / 4000 (e.g. DEV_PORT=5174 DEV_API=http://localhost:4100).
const API = process.env.DEV_API || 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.DEV_PORT) || 5173,
    strictPort: true,
    proxy: {
      '/api': { target: API, changeOrigin: true },
      '/uploads': { target: API, changeOrigin: true },
      '/socket.io': { target: API, changeOrigin: true, ws: true },
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 2000,
  },
});
