# In-game screen: panels, interface art, cursors, selection marker

Read from aoe1-decomp `src/scr_game.cpp`, `src/tpnl_obj.cpp`, `src/tpnl_inv.cpp`, `src/stat_obj.cpp`, `src/view.cpp`, `src/Mouseptr.cpp`. Code: `apps/client/src/hud/`.

## Interface SLPs (interfac.drs ids; `data2/Interfac.drs` overrides `data/`)
The ids are `base + culture` (Egyptian 0, Greek 1, Babylonian 2, East Asian 3; Roman uses 53001-53012 from data2, not wired).
- Screen: `game_a/b/c` = 50733 / 50737 / 50741 (+culture) for 640x480 / 800x600 / 1024x768 (scr_game.cpp:2263-2277). Frame 0 is the top strip (20 px), frame 1 the bottom panel (126 px). The bottom panel's minimap spot is a magenta diamond: the game draws the minimap over it.
- Command buttons: `btncmd` 50721 (command icons), `btnunit` 50730 (unit icons 50x50, player colour), `btntech` 50729, `btnbldg_<culture>` 50704+culture (building icons), borders 50713+c (54x54 slot), 50717+c (72x20), 50747+c (108x20), `button_other` 50725+c.
- Object panel: `health` 50745 (26 frames 50x7, frame = 26 - 26 * hp / max), `itemicon` 50731 (carried resource icons).
- `mcursors` 51000: frame 0 arrow, 1 hourglass, 2 move/target arrows, 3 hand (work, repair), 4 sword (attack), 5 ring (ground target), 6 help. `TRIBE_Player::get_mouse_pointer_action_vars` picks the facet from the click tables: 0 for an own unit or nothing to do, 3 for work targets, 4 attack, 5 convert/heal. A player's own units get facet 0 (the arrow).
- Menu backgrounds 50100-50153, dialog frames etc. are imported (source `interface` in the pack) but not used yet. Palette 50500 is a `bina`.

## Layout (`TRIBE_Screen_Game::handle_size`, scr_game.cpp:757)
The original runs at a fixed size (>= 1024x768, >= 800x600, else 640x480 picks the art); screen coordinates at 1024x768:
top strip 0..20: resource text at x 32 / 99 / 166 / 233 (wood, food, gold, stone; the icons are in the art), y 2; age text at (270, 2, 492x16); chat (772, 0, 72x19), diplomacy (844, 0, 108x19), menu (952, 0, 72x19). Bottom panel from y 642: object panel (5, 649, 127x114), 12 command slots 54x54 from (136, 650), 58 px between rows, minimap (795, 648, 220x114), help and score buttons (989, 732) and (989, 650), 30x30. 800x600 and 640x480 differ in the right-hand x positions (`layout.ts` has them); at 640x480 slots 5 and 11 are the wide "more"/"cancel" buttons.
Text colours for the Egyptian, Greek styles: black with a white shadow at (-1, +1) (`set_text_color(0, 0xFFFFFF)`); Babylonian, East Asian, Roman: white.

## Object panel (`TRIBE_Panel_Object::draw`)
From the panel corner: owner (civilization) name at (3, -2), object name at (3, 13), icon at (3, 30) (`master.button_pict` frame; `btnbldg` + building facet for buildings), hit point bar at (3, 84), `hp/max` text at (3, 92), then attack/armor rows. Text is white.

## Selection marker (`RGE_Static_Object::capture_frame_3d_square`, default `outline_type` 2)
A white diamond on the ground with corners `(+-outline_radius_x, +-outline_radius_y)` (the dat unit's `outlineSize`), projected with `RGE_Map::get_point`: offset `((y + x) * 32, (y - x - z) * 16)`. Over the corner `(rx, -ry, rz)` a 24x2 bar: `hp * 24 / max + 1` px green (palette 0x4a), the rest red (0x97). `Draw_GDI_Object` (view.cpp:2765) draws them.
