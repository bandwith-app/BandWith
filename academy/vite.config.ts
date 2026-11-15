/**
 * BandWith Academy: a standalone static site (preview, not yet linked from
 * the app or the landing). Run: npx vite --config academy/vite.config.ts
 */
import { defineConfig } from 'vite';
import path from 'path';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: __dirname,
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '../src'),
      'lucide-react': path.resolve(__dirname, '../src/app/components/icons'),
    },
  },
  server: { port: 5190, host: '127.0.0.1' },
  build: { outDir: path.resolve(__dirname, '../dist-academy'), emptyOutDir: true },
});
