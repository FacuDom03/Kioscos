import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    // Service worker (Workbox): guarda la app completa para abrir sin conexión. Las llamadas a la
    // API no se guardan acá; los datos van a IndexedDB (sección 12).
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icono.svg', 'apple-touch-icon.png', 'tema.js'],
      manifest: {
        name: 'Mostrador',
        short_name: 'Mostrador',
        description: 'Ventas, stock y caja del kiosco.',
        lang: 'es-AR',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#111936',
        theme_color: '#111936',
        icons: [
          { src: '/icono-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icono-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icono-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,svg,png}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/health/],
        cleanupOutdatedCaches: true,
        runtimeCaching: [],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:3000',
    },
  },
  preview: {
    // Solo para las pruebas de punta a punta: la API de e2e corre en el 3100.
    proxy: { '/api': 'http://127.0.0.1:3100' },
  },
  build: {
    // Sin scripts en línea, para la CSP estricta (script-src 'self').
    assetsInlineLimit: 0,
  },
});
