import { defineConfig } from '@playwright/test';
import { shared } from './playwright.shared';
import { syntheticPackDir } from './synthetic-pack';

// The production start command alone (`npm run start`: the server serves the page, `/assets` and `/ws` on one origin, no
// `vite preview`), on its own port. Runs the lobby and smoke specs against it: `npm run test:e2e:prod`.
const port = Number(process.env.PROD_PORT ?? 8987);

export default defineConfig({
  ...shared,
  workers: 1,
  testMatch: /(lobby|smoke)\.spec\.ts/,
  use: { baseURL: `http://localhost:${port}` },
  webServer: {
    command: 'npm run build && npm run start',
    cwd: '..',
    url: `http://localhost:${port}/health`,
    env: { PORT: String(port), ASSETS_DIR: syntheticPackDir, LOBBY_CIV: '1' },
    reuseExistingServer: false,
    timeout: 300_000,
  },
});
