import { defineConfig } from '@playwright/test';
import { BASE_URL } from './stack/stack';

// One shared Docker stack per run, so tests run one at a time: a spec that
// restarts or redeploys the app would pull it from under any other.
export default defineConfig({
  globalSetup: './stack/globalSetup.ts',
  globalTeardown: './stack/globalTeardown.ts',
  workers: 1,
  fullyParallel: false,
  retries: process.env.E2E_RETRIES ? Number(process.env.E2E_RETRIES) : 1,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  reporter: [['list'], ['html', { outputFolder: 'report', open: 'never' }]],
  outputDir: 'test-results',
  use: {
    baseURL: BASE_URL,
    channel: 'chrome',
    headless: process.env.E2E_HEADED !== '1',
    // a missing element fails the step quickly instead of eating the whole test timeout
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      // a fake camera and microphone, granted without a prompt, so calls carry real media
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
    },
  },
  projects: [
    { name: 'features', testDir: './specs/features' },
    { name: 'restart', testDir: './specs/restart' },
    { name: 'upgrade', testDir: './specs/upgrade', timeout: 900_000 },
  ],
});
