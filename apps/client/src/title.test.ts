import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { GAME_TITLE } from './title';

test('index.html carries the game title', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  expect(html).toContain(`<title>${GAME_TITLE}</title>`);
  expect(html).toContain(`<h1 id="title">${GAME_TITLE}</h1>`);
});
