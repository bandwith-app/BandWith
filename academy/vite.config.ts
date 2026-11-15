/**
 * BandWith Academy: the user guide, a small static site built next to the
 * app (pnpm build runs both). Dev: npx vite --config academy/vite.config.ts
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
  // Built into the app's dist/academy: the native apps ship it (opens offline
  // from Settings and the ? buttons) and the web serves it at /academy/.
  build: {
    outDir: path.resolve(__dirname, '../dist/academy'),
    emptyOutDir: true,
    // one bundle on purpose: the guide's text is most of it, and it opens offline
    chunkSizeWarningLimit: 900,
  },
});
