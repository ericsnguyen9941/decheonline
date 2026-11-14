// Where the in-game panels sit, from TRIBE_Screen_Game::handle_size (src/scr_game.cpp:757): the original runs at a fixed
// 640x480, 800x600 or 1024x768 and draws the top strip and the bottom panel from one SLP per size and culture.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Interface SLPs (interfac.drs ids) of one culture's panels; `+ culture` for Egyptian 0, Greek 1, Babylonian 2, East Asian 3. */
export const SLP = {
  /** `game_a/b/c`: frame 0 is the top strip, frame 1 the bottom panel. */
  screen: { 640: 50733, 800: 50737, 1024: 50741 },
  /** `button_border_a`: 54x54 frames of a command button slot. */
  buttonBorder: 50713,
  /** `button_border_b`: 72x20, frame 0 up, frame 1 pressed. */
  menuButton: 50717,
  /** `button_border_c`: 108x20. */
  wideMenuButton: 50747,
  /** `btncmd`: command icons. */
  commands: 50721,
  /** `btnunit`: unit icons, 50x50. */
  unitIcons: 50730,
  /** `btnbldg_<culture>`: building icons, 50x50. */
  buildingIcons: 50704,
  /** `health`: 26 frames of the hit point bar, full first. */
  health: 50745,
  /** `mcursors`: the mouse cursors. */
  cursors: 51000,
} as const;

/** Panels in pixels, relative to the HUD's left edge; `bottom` ones relative to the top of the bottom panel. */
export interface HudLayout {
  /** Nominal screen size the art was drawn for (also the HUD's width). */
  width: 640 | 800 | 1024;
  topHeight: number;
  bottomHeight: number;
  /** `inven_panel`: wood, food, gold, stone text starts at these x, at y 2. */
  resourceX: [number, number, number, number];
  age: Rect;
  /** Chat, diplomacy and menu buttons in the top strip. */
  topButtons: [Rect, Rect, Rect];
  /** Selected object panel (bottom-relative). */
  object: Rect;
  /** The 12 command button slots, row by row (bottom-relative). */
  buttons: Rect[];
  /** The minimap's frame (bottom-relative). */
  minimap: Rect;
}

export const TOP_HEIGHT = 20;
export const BOTTOM_HEIGHT = 126;

function layout(width: 640 | 800 | 1024, minimap: Rect, topX: number, ageWidth: number): HudLayout {
  const buttons: Rect[] = [];
  for (let row = 0; row < 2; row++) for (let col = 0; col < 6; col++) buttons.push({ x: 136 + 54 * col, y: 8 + 58 * row, w: 54, h: 54 });
  return {
    width,
    topHeight: TOP_HEIGHT,
    bottomHeight: BOTTOM_HEIGHT,
    resourceX: [32, 99, 166, 233],
    age: { x: 270, y: 2, w: ageWidth, h: 16 },
    topButtons: [
      { x: topX, y: 0, w: 72, h: 19 },
      { x: topX + 72, y: 0, w: 108, h: 19 },
      { x: topX + 180, y: 0, w: 72, h: 19 },
    ],
    object: { x: 5, y: 7, w: 127, h: 114 },
    buttons,
    minimap,
  };
}

const LAYOUTS = {
  // The minimap sits at screen (795, 648), (571, 480), (411, 362); the bottom panel starts 126 rows above the screen's bottom.
  1024: layout(1024, { x: 795, y: 6, w: 220, h: 114 }, 772, 492),
  800: layout(800, { x: 571, y: 6, w: 220, h: 114 }, 548, 268),
  640: layout(640, { x: 411, y: 8, w: 220, h: 114 }, 388, 106),
} as const;

/** The art for the largest nominal size that fits the window, as the original picks by its screen size. */
export function hudLayout(windowWidth: number, windowHeight: number): HudLayout {
  if (windowWidth >= 1024 && windowHeight >= 768) return LAYOUTS[1024];
  if (windowWidth >= 800 && windowHeight >= 600) return LAYOUTS[800];
  return LAYOUTS[640];
}
