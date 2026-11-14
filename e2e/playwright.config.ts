import { defineConfig } from '@playwright/test';
import { syntheticPackDir } from './synthetic-pack';

// Own ports so the e2e run never collides with a `npm run dev` left running.
const clientPort = 5273;
const serverPort = 8887;
const baseURL = `http://localhost:${clientPort}`;

export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  // One baseline per screenshot, not per OS: the synthetic art is flat colour, so engines agree.
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}{ext}',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  use: { baseURL },
  webServer: {
    command: 'npm run dev',
    cwd: '..',
    url: baseURL,
    env: { CLIENT_PORT: String(clientPort), PORT: String(serverPort), ASSETS_DIR: syntheticPackDir },
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
