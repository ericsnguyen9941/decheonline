import { defineConfig } from '@playwright/test';
import { shared } from './playwright.shared';

// 20 minutes of game time between two clients (tests/soak.spec.ts): manual, never part of `npm run test:e2e`.
export default defineConfig({
  ...shared,
  workers: 1,
  testMatch: /soak\.spec\.ts/,
});
