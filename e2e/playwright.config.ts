import { defineConfig } from '@playwright/test';

// Own ports so the e2e run never collides with a `npm run dev` left running.
const clientPort = 5273;
const serverPort = 8887;
const baseURL = `http://localhost:${clientPort}`;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  use: { baseURL },
  webServer: {
    command: 'npm run dev',
    cwd: '..',
    url: baseURL,
    env: { CLIENT_PORT: String(clientPort), PORT: String(serverPort) },
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
