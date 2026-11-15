import { defineConfig } from 'vite'
import path from 'path'
import { existsSync } from 'fs'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

// Android remote push needs Firebase: android/app/google-services.json. Every
// build that has the file switches FCM on by itself (VITE_ANDROID_PUSH in the
// environment still wins), so a plain `vite build` + `cap sync` APK gets push.
const androidPush =
  process.env.VITE_ANDROID_PUSH ??
  (existsSync(path.resolve(__dirname, 'android/app/google-services.json')) ? 'true' : 'false')

export default defineConfig(({ mode }) => ({
  define: {
    'import.meta.env.VITE_ANDROID_PUSH': JSON.stringify(androidPush),
  },
  plugins: [
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
  ],
  // Production builds drop console.log/info/debug (they printed push tokens,
  // notification payloads and user ids: audit PR-116). warn/error stay.
  esbuild: mode === 'production' ? { pure: ['console.log', 'console.info', 'console.debug'] } : undefined,
  build: {
    rollupOptions: {
      // Second page: /unsubscribe.html (product news emails, migration 065).
      input: {
        main: path.resolve(__dirname, 'index.html'),
        unsubscribe: path.resolve(__dirname, 'unsubscribe.html'),
        // Third page: /deputy.html (deputy reply link, migration 084).
        deputy: path.resolve(__dirname, 'deputy.html'),
        // Fourth page: /rider.html (the venue's read-only rider link, migration 093).
        rider: path.resolve(__dirname, 'rider.html'),
        // Fifth page: /quote.html (the client confirms a quote, migration 099).
        quote: path.resolve(__dirname, 'quote.html'),
      },
    },
  },
  server: {
    watch: {
      usePolling: true,
      interval: 100,
    },
  },
  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './src'),
      // Route all Lucide icon imports to BandWith's unified custom icon system
      'lucide-react': path.resolve(__dirname, './src/app/components/icons'),
    },
  },
}))
