import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/ui',
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:4040',
      '/health': 'http://localhost:4040',
    },
  },
  build: {
    outDir: '../../dist/ui',
    emptyOutDir: true,
  },
});
