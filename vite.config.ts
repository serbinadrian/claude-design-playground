import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@app': fileURLToPath(new URL('./src/client/app', import.meta.url)),
      '@client': fileURLToPath(new URL('./src/client', import.meta.url)),
      '@components': fileURLToPath(new URL('./src/client/components', import.meta.url)),
      '@hooks': fileURLToPath(new URL('./src/client/hooks', import.meta.url)),
      '@server': fileURLToPath(new URL('./src/server', import.meta.url)),
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
  build: {
    outDir: 'dist/client',
  },
});
