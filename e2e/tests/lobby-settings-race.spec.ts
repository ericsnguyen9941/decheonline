import { expect, test } from '@playwright/test';

// The host changes several settings before the server's echo of the first arrives: every pick must reach the server
// and the guest, and the host's own selects keep what was picked (no lost update from a stale snapshot).
const URL = '/?debug=net&speed=20';

for (const guestActs of [false, true]) {
test(`quick successive setting changes by the host all arrive, with the server slow to answer${guestActs ? ' and the guest picking a civ meanwhile' : ''}`, async ({ browser }) => {
  const hostPage = await (await browser.newContext()).newPage();
  const guest = await (await browser.newContext()).newPage();
  // Server -> host messages are held back 300 ms; host -> server ones go through at once.
  await hostPage.routeWebSocket(/\/ws/, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((m) => server.send(m));
    server.onMessage((m) => setTimeout(() => ws.send(m), 300));
  });
  await hostPage.goto(URL);
  await guest.goto(URL);
  await hostPage.getByTestId('name').fill('Alice');
  await hostPage.getByTestId('create').click();
  const code = (await hostPage.getByTestId('invite-code').textContent())!;
  await guest.getByTestId('name').fill('Bob');
  await guest.getByTestId('code').fill(code);
  await guest.getByTestId('join').click();
  await expect(hostPage.getByTestId('player-1')).toContainText('Bob');

  await hostPage.getByTestId('map-size').selectOption('96');
  await hostPage.getByTestId('map-type').selectOption({ label: 'Hill Country' });
  // A guest's lobby echo (its civ) lands between the host's changes and must not pass for the answer to them.
  if (guestActs) await guest.getByTestId('civ-1').selectOption({ index: 2 });
  await hostPage.getByTestId('victory').selectOption({ label: 'Conquest' });
  await hostPage.getByTestId('starting-age').selectOption({ label: 'Tool Age' });
  await hostPage.getByTestId('reveal-map').check();

  const lines = ['Scenario: Random Map', 'Map Size: Small', 'Map Type: Hill Country', 'Victory: Conquest', 'Age: Tool Age', 'Resources: Default', 'Reveal Map: Yes', 'Full Tech Tree: No', 'Population Limit: 50'];
  await expect(guest.getByTestId('settings-summary').locator('li')).toHaveText(lines);
  // Past every delayed echo the host's selects still show the picks.
  await hostPage.waitForTimeout(1000);
  await expect(hostPage.getByTestId('map-size')).toHaveValue('96');
  await expect(hostPage.getByTestId('map-type').locator('option:checked')).toHaveText('Hill Country');
  await expect(hostPage.getByTestId('victory').locator('option:checked')).toHaveText('Conquest');
  await expect(hostPage.getByTestId('starting-age').locator('option:checked')).toHaveText('Tool Age');
  await expect(hostPage.getByTestId('reveal-map')).toBeChecked();
  await expect(guest.getByTestId('settings-summary').locator('li')).toHaveText(lines);
});
}
