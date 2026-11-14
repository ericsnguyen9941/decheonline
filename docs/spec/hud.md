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

First item row (tpnl_obj.cpp:430-480), own buildings only: under construction, `item` icon 50731 frame 9 and the construction percent (`get_construction_progress`: `trunc(build_points / train_time * 100)` in float32); training, the same icon and the unit's percent (`production_queue_status`, `trunc(work_done * 100 / train_time)`; 0 for a queued unit not started); a House otherwise shows frame 4 and `population / min(population + headroom, limit)`. The sim's live population count is attribute 11 and the headroom attribute 4; attribute 32 is the limit and 33 is not the live count. `apps/client/src/hud/game-hud.ts` `itemRow`.

## Command buttons (`TRIBE_Screen_Game::setup_buttons`, scr_game.cpp:2409; `do_button_action`)
- Grid: 12 slots, 0-4 the top row, 6-10 the bottom row; slot 5 is "more" and slot 11 is cancel/unselect (hotkey Esc). Each icon is a 50x50 frame inside the 2 px slot border (border SLP 50713 + culture, `TRIBE_Panel_Button::draw` type 0).
- Slot of a master: `calc_button_loc` maps the dat `button_location` 1-5 to slots 0-4, 6-10 to 6-10 (first page), 11-15 to 0-4 and 16-20 to 6-10 (second page). Without a Range (87) among the buildable items, the Town Center's button moves to location 6. A later button set in the same slot replaces the earlier one.
- Items: `interface_item_avail` lists the player's enabled masters (master type >= 70) whose `train_location` is the maker: the Builder (the build menu) or the building's id. A player without a Town Center may build one while attribute 48 is 0.
- Icons: `btncmd` 50721 (data2 frames are 800x600 sheets with the icon top left): Build 2, Cancel Construction 3, Cancel and Unselect 10, More 11. Building items: `btnbldg` 50704 + culture, frame `icon + buildingFacet` (the facet the age gives). Unit items: `btnunit` 50730 frame `icon`, player colour.
- Modes (`game_mode`): normal; build menu (`TRIBE_GAME_MODE_BUILD_MENU`) with the items, "more" when any item is on the other page, and Cancel; placing a building with only Cancel.
- Villager-class units (`unit_level` 3; in the sim, units whose task swap group holds a unit with a build task) get Build in slot 0 and Unselect. A foundation of one's own gets Cancel Construction in slot 0. An active building gets its train items: with a queue only the queued items stay, each with its count over the icon; left click sends `queue` +1, right click `queue` -1 (takes one off the stack, refunding it). Another player's object gets only Unselect.
- Code: `apps/client/src/hud/commands.ts` (pure, unit tests), `command-panel.ts` (DOM and clicks). A building the player cannot pay for is refused before placement starts (`checkObjCost`); a train the player cannot pay for is sent and the sim refuses it, as `command_train` does with production queues.

## Building placement (`TRIBE_Screen_Game` place mode)
- The ghost is the building's sprite at the facet `buildingFacet` gives, alpha 0.6, on the tile the cursor aligns to (float32 port of the original's alignment, `apps/client/src/units/placement.ts`). When `checkPlacement` fails it is tinted with a red that pulses through palette 0x24-0x28, stepping every 128 ms of world time. Left click issues `build`; right click or Esc cancels.
- Buildings with a draw list (House 817, Town Center) have no SLP of their own: `RGE_Sprite::draw` (sprite.cpp:541) draws each delta in list order at its offset, at its angle or every angle, at facet `part_facets * facet / facets` and the same frame. `apps/client/src/units/composite.ts` bakes the parts into one texture per facet and frame, so hit test and depth sort treat it as one sprite. The pack (version 4) carries `PackGraphic.deltas` and `PackUnit.button`.

## Selection marker (`RGE_Static_Object::capture_frame_3d_square`, default `outline_type` 2)
A white diamond on the ground with corners `(+-outline_radius_x, +-outline_radius_y)` (the dat unit's `outlineSize`), projected with `RGE_Map::get_point`: offset `((y + x) * 32, (y - x - z) * 16)`. Over the corner `(rx, -ry, rz)` a 24x2 bar: `hp * 24 / max + 1` px green (palette 0x4a), the rest red (0x97). `Draw_GDI_Object` (view.cpp:2765) draws them.
