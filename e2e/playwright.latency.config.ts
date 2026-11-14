import { defineConfig } from '@playwright/test';
import { shared } from './playwright.shared';

// Wall-clock click-to-action timing: manual, on an idle machine (check `uptime`), never part of `npm run test:e2e`.
export default defineConfig({
  ...shared,
  workers: 1,
  testMatch: /latency\.spec\.ts/,
});
