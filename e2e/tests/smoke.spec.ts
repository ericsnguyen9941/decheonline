import { expect, test } from '@playwright/test';

test('page loads and shows the game title', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('AoE1 Web');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('AoE1 Web');
  // The canvas is hidden behind the lobby until a game starts.
  await expect(page.getByTestId('game-canvas')).toBeAttached();
  await expect(page.getByTestId('lobby')).toBeVisible();
});
