import { expect, test } from 'vitest';
import { BOTTOM_HEIGHT, hudLayout } from './layout';

test('the art follows the largest original screen size that fits the window', () => {
  expect(hudLayout(1920, 1080).width).toBe(1024);
  expect(hudLayout(1024, 768).width).toBe(1024);
  expect(hudLayout(1280, 700).width).toBe(800);
  expect(hudLayout(800, 600).width).toBe(800);
  expect(hudLayout(640, 480).width).toBe(640);
  expect(hudLayout(300, 200).width).toBe(640);
});

test('panels sit where TRIBE_Screen_Game::handle_size puts them', () => {
  const l = hudLayout(1024, 768);
  // Screen (5, 649) with the bottom panel starting at row 642.
  expect(l.object).toEqual({ x: 5, y: 7, w: 127, h: 114 });
  expect(l.buttons).toHaveLength(12);
  expect(l.buttons[0]).toEqual({ x: 136, y: 8, w: 54, h: 54 });
  expect(l.buttons[11]).toEqual({ x: 136 + 5 * 54, y: 8 + 58, w: 54, h: 54 });
  expect(l.minimap).toEqual({ x: 795, y: 6, w: 220, h: 114 });
  expect(l.topButtons.map((r) => r.x)).toEqual([772, 844, 952]);
  expect(l.bottomHeight).toBe(BOTTOM_HEIGHT);
});
