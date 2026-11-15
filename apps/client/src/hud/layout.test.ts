import { expect, test } from 'vitest';
import { BOTTOM_HEIGHT, cultureSlp, hudLayout, SLP } from './layout';

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

test("a culture's panels and building icons: base + culture, data2's ids for Roman, Egyptian past it (scr_game.cpp:166-171, :2147-2277)", () => {
  // Egyptian, Greek, Babylonian, East Asian building icons: btnbldg0-3.
  expect([0, 1, 2, 3].map((c) => cultureSlp(SLP.buildingIcons, c))).toEqual([50704, 50705, 50706, 50707]);
  expect(cultureSlp(SLP.buttonBorder, 2)).toBe(50715);
  expect(cultureSlp(SLP.screen[800], 3)).toBe(50740);
  // Roman: btnbldg4 53005, button_border_a/b/c 53006-53008, game_a/b/c 53010-53012.
  expect([SLP.buildingIcons, SLP.buttonBorder, SLP.menuButton, SLP.wideMenuButton].map((s) => cultureSlp(s, 4))).toEqual([53005, 53006, 53007, 53008]);
  expect([640, 800, 1024].map((w) => cultureSlp(SLP.screen[w as 640 | 800 | 1024], 4))).toEqual([53010, 53011, 53012]);
  expect(cultureSlp(SLP.buildingIcons, 7)).toBe(50704);
});
