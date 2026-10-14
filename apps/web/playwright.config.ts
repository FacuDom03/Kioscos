import { defineConfig, devices } from '@playwright/test';

// Tamaños de la sección 4.1 de docs/SPEC.md. Celular y tablet con pantalla táctil (puntero
// grueso); la computadora con mouse (puntero fino).
const tactil = { isMobile: true, hasTouch: true } as const;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  reporter: process.env['CI'] ? [['github'], ['list']] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    ...devices['Desktop Chrome'],
  },
  projects: [
    { name: 'celular-chico', use: { viewport: { width: 360, height: 640 }, ...tactil } },
    { name: 'celular', use: { viewport: { width: 390, height: 844 }, ...tactil } },
    { name: 'tablet', use: { viewport: { width: 1024, height: 768 }, ...tactil } },
    { name: 'pc', use: { viewport: { width: 1366, height: 768 } } },
  ],
  webServer: {
    command: 'pnpm build && pnpm preview',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
});
