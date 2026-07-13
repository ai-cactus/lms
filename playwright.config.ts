import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  timeout: 60000,
  expect: {
    timeout: 10000,
  },
  use: {
    baseURL: 'http://localhost:3005',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // CI serves the production build (`next build` runs as a prior workflow
    // step): `next dev`'s lazy route compilation has intermittently failed to
    // register interleaved route-group routes (e.g. /dashboard/(wizard)/
    // training/courses/[id]/assign 404'd for a whole run), and `next start`
    // resolves the full route manifest ahead of time. Local runs keep the dev
    // server for fast iteration.
    command: process.env.CI ? 'npm run start -- -p 3005' : 'npm run dev -- -p 3005',
    url: 'http://localhost:3005',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
    // Override the app URL for the e2e server only, so email links generated
    // during tests point at Playwright's 3005 server rather than the 3000 value
    // in .env.local (which is for manual dev). Injected env wins over .env.local.
    env: {
      NEXT_PUBLIC_APP_URL: 'http://localhost:3005',
      APP_URL: 'http://localhost:3005',
    },
  },
});
