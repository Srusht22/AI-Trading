import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests drive the real app in a real browser against a running
 * Supabase stack (npm run db:start) and Mailpit for emails.
 * Requires .env.local (browser config) and .env.server.local (server tooling).
 */
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    launchOptions: executablePath ? { executablePath } : undefined,
  },
  projects: [
    { name: 'desktop', testIgnore: /(csp|pages)\.spec\.ts/, use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', testIgnore: /(csp|pages)\.spec\.ts/, use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } }, grep: /@mobile/ },
    // Production build served with the real security headers (CSP, Trusted Types, frame-ancestors…).
    { name: 'production-csp', testMatch: /csp\.spec\.ts/, use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:4173' } },
    // Production build + Pages Functions on Cloudflare's local runtime (workerd), with a real diagnostics agent.
    { name: 'pages', testMatch: /pages\.spec\.ts/, use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:8788' } },
  ],
  webServer: [
    {
      command: 'npm run dev -- --port 5173 --strictPort',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: 'npm run build && npx vite preview --port 4173 --strictPort',
      url: 'http://localhost:4173',
      // Always test a fresh production build, never a stale preview.
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      // Separate output dir so it never races the preview build above.
      command: 'npx vite build --outDir .pages-e2e --emptyOutDir && node scripts/pages-dev.mjs --dir .pages-e2e',
      url: 'http://127.0.0.1:8788/api/health',
      reuseExistingServer: false,
      timeout: 240_000,
    },
  ],
});
