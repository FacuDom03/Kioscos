import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
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
