import { defineConfig, devices } from 'playwright/test';

const baseURL = process.env.KODIGO_E2E_BASE_URL || 'http://127.0.0.1:4173';
const parsedBaseURL = new URL(baseURL);
const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1']);
const isLoopback = loopbackHosts.has(parsedBaseURL.hostname);
const useProductionPreview = process.env.KODIGO_E2E_PRODUCTION_PREVIEW === 'true';

if (parsedBaseURL.username || parsedBaseURL.password) {
  throw new Error('KODIGO_E2E_BASE_URL must not contain credentials.');
}

if (!isLoopback && process.env.KODIGO_E2E_ALLOW_REMOTE_READ_ONLY !== 'true') {
  throw new Error('Remote E2E requires KODIGO_E2E_ALLOW_REMOTE_READ_ONLY=true.');
}

if (!isLoopback && parsedBaseURL.protocol !== 'https:') {
  throw new Error('Remote E2E targets must use HTTPS.');
}

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  ...(isLoopback ? {
    webServer: {
      command: useProductionPreview
        ? 'npm run preview -- --host 127.0.0.1 --port 4173 --strictPort'
        : 'npm run dev -- --host 127.0.0.1 --port 4173 --strictPort',
      url: baseURL,
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        VITE_SUPABASE_URL: 'https://kodigo-e2e.invalid',
        VITE_SUPABASE_ANON_KEY: 'e2e-placeholder-key-not-a-credential',
      },
    },
  } : {}),
});
