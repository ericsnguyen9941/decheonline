# Visibility: explored and visible tiles, line of sight, visible-unit records

Fog of war as game state: which tiles each player has explored and sees now,
how objects add and remove their line of sight (LOS), the per-player
visible-unit records the unit AI searches, and the game rules that read them.
Refs are aoe1-decomp @ `6d6d8b1`. Port: `packages/sim/src/visibility.ts`
(state, shapes, records), hooks in `movement.ts` (`teleport`), `objects.ts`,
`buildings.ts`, `gather.ts` (`transform`), `techs.ts`, `unit-ai.ts`,
`combat.ts`; tests in `visibility.test.ts`. Drawing the fog and the minimap is
client work and is not covered here.

## 1. State

### 1.1 Per-player viewer counts (`RGE_Visible_Map`, `src/visible.cpp:154-187`)

One byte per tile per player, row-major, every player including Gaia:

| byte | meaning |
| --- | --- |
| 0xFF | unexplored (initial value) |
| 0x00 | explored, no own viewer now |
| 1..0xF9 | number of the player's own LOS shapes covering the tile |

Plus `numberTilesExploredValue`, the count of tiles this player explored.

### 1.2 Shared bit map (`unified_map_offsets`, `src/visible.cpp:771-856`)

One u32 per tile for all players: bit `p` is set while player `p`'s count
there is ≥ 1, bit `p + 16` once `p` explored it. Explore and unexplore keep
it in step with the counts (§2.2); nothing else writes it in a game.

### 1.3 Query (`get_visible`, `src/visible.cpp:256-264`)

`0x0F` (visible) if the cell has any bit of the player's `mutualVisibleMask`,
else `0x80` (fogged) if any bit of its `mutualExploredMask`, else 0 (black).
The masks are rebuilt in `update_mutual_allies` (`src/world.cpp:3215-3260`):
every player has its own bits; a player ≥ 1 with allied LOS on also gets the
bits of each player ≥ 1 that both consider an ally (relation 0 each way).
Gaia never shares. New players set every other player to enemy
(`src/tplayer.cpp:252-259`) and the 1v1 game has no diplomacy change, so in
the port the masks are the player's own bits only.

### 1.4 Hashed and saved

The counts and the bit map are saved with the game (`src/visible.cpp:244-254`,
`:824-830`) and the multiplayer sync check XORs them
(`checksumVisible`, `checksumUnifiedVisible`, `src/visible.cpp:863-912`).
They feed the unit AI (§4) and placement (§5), so they are game state: the
port hashes and snapshots the counts, the bit map, the explored counts, the
visible-unit records and each combat object's last cell (§4.1). The
`input_csum` call hash (`src/visible.cpp:408-423`) is read by nothing in the
game and is not kept.

## 2. Shapes and the explore operations

### 2.1 Shapes (`NormalLOS`, `SquareLOS`, `src/visible.cpp:11-143`)

Static tables of rows `(dy, x1, x2)` per radius 0..16, ported as numeric data
(`NORMAL_HALF`, `SQUARE_HALF`). Every normal row is symmetric (`x1 = -x2`)
and the table is symmetric in `dy`, so it is stored as half-widths for
`|dy| = 0..r`. A square shape of radius `r ≥ 1` has rows `dy = -r..r-1`,
each covering `-w-1..w`; radius 0 is the single tile. Tile counts of the
normal shapes used below: r 4 → 61, 5 → 97, 8 → 221, 10 → 349. The unit-AI
distance table (unit-ai.md §3.2) is "smallest normal radius whose shape holds
the cell"; a test derives it from the shapes and checks it against the
port's table.

### 2.2 Explore and unexplore (`src/visible.cpp:397-762`)

- `explore(player, tx, ty, r, square)`: clamp `r` to 16; for each row whose
  `ty + dy` is on the map, clip `tx + x1 .. tx + x2` to the map; per tile add
  one viewer (u8 arithmetic). A tile going from 0xFF wraps to 0: it counts as
  newly explored, the explored count grows, its explored bit is set, and the
  count becomes 1. A count of 1 sets the visible bit. A count of 0xFA is cut
  back to 0xF9. Returns the newly explored tiles.
- `unexplore`: the same rows; subtract one viewer, an underflow from 0 stays
  0; a count reaching 0 clears the visible bit. Tiles never become unexplored.
- The rectangle forms (`explore_terrain_sq`, `unexplore_terrain_sq`) do the
  same on `x1..x2 × y1..y2`, returning early when the rectangle misses the
  map and clipping it otherwise.
- `Map_Update_Suppresion` (editor), the new-tile lists and the draw state of
  the local player's tiles are display-side and not ported.

## 3. When objects explore (`RGE_Static_Object::explore_terrain`, `src/stat_obj.cpp:2114-2159`)

### 3.1 Object explore and unexplore

`explore(owner, type, los)`: radius `los`, or `(int)master.los` when -1;
nothing unless the radius is > 0. Type 0 is the normal shape around
`((int)x, (int)y)`. Type 1 is the footprint rectangle
`(int)(x - rx) .. (int)(x + rx - 0.01)` (same for y, float32 steps, master
radii), only when both radii are > 0. `TRIBE_Building_Object` overrides
explore only: while unbuilt (`built == 0`, build points below the
requirement) every explore is type 1 (`src/t_b_obj.cpp:365-370`). Unexplore
has no override.

### 3.2 Moving (`new_location`, `src/stat_obj.cpp:1513-1529`)

When an object outside any container lands on a new tile (tiles clamped to
the map): unexplore type 0 at the old position (if it had a tile), move,
then explore type 0 at the new one if it is active. Moving inside a tile
does nothing. The first placement of a new object has no old tile; objects
are created active, so it explores — a new foundation therefore sees its
footprint. Missiles have LOS -1 and never explore.

### 3.3 State changes (`set_object_state`, `src/stat_obj.cpp:1938-1949`)

Before the state is stored:

- entering dying or later from active: unexplore type 0, then, if master LOS
  > 0, explore type 1 (a dying object keeps seeing its footprint);
- entering pending removal from an earlier state, LOS > 0: unexplore type 1.

A building finishing (`TRIBE_Building_Object::set_object_state(active)`,
`src/t_b_obj.cpp:248-254`) unexplores type 1 and explores type 0 after
setting `built`, unless it goes away when built. `destroy_obj` goes to
pending removal through the same rules.

### 3.4 Transform (`src/stat_obj.cpp:1778-1793`)

Unexplore with the old master, switch masters, explore with the new one,
whatever the state (Villager ↔ builder/gatherer types).

### 3.5 LOS effects

- Instance side of master attribute code 1 on an active object
  (`modify` / `modify_delta` / `modify_percent` flag 1,
  `src/stat_obj.cpp:1728-1774`): unexplore type 0 with the current master,
  explore type 0 with radius `(int)d` (set), `(int)(los + d)` (add) or
  `(int)(los × d)` (multiply). The master changes after its objects
  (techs.md §4.2), so later calls use the new LOS.
- `copy_obj` on an active object (`src/stat_obj.cpp:1808-1812`): unexplore
  type 0, explore with `(int)source.los`.
- Ownership change and entering a container also move LOS
  (`src/stat_obj.cpp:1686-1717`, `:2083-2085`); neither exists in the port yet.

## 4. Visible-unit records (`Visible_Unit_Manager`, `src/vis_unit.cpp`)

### 4.1 Keeping them (`Update_Unit_Info`, `src/vis_unit.cpp:119-193`)

Each player has one record list per object group; a record holds the object
id, its owner, and its tile. Every combat object (master type ≥ 50: units,
buildings, missiles) stores the bit-map cell of its tile from its last update
(`Unified_Map_Value`). At the end of `RGE_Combat_Object::update`, after its
actions and before its unit AI, whatever its state
(`src/com_obj.cpp:432-451`), it reads the cell of `((int)x, (int)y)`; if it
differs from the stored one, for each player p (in index order) whose visible
bit changed: bit now set → append a record with the object's current tile
and owner to p's list for the object's group; bit now clear → move p's last
record of that list into the object's record slot and shrink the list. The
destructor removes every record the object still has
(`src/com_obj.cpp:40-45`).

So a record's tile and owner are those of the moment p started seeing the
object; they do not follow it while p keeps seeing it (the decomp's `@bug`
note at `src/com_obj.cpp:443-446`). The swap-removal changes list order,
which decides ties in the unit AI. The port assumes an object's group does
not change while it has records (true for every type in the table). The
`capture_flag` first-sight capture (`:452-479`) is for objects the sim does
not have.

### 4.2 Searching (`GetVisibleUnits`, `src/vis_unit.cpp:195-278`)

The search of unit-ai.md §3.2 reads only the searching player's lists, in
important-group order then list order, filtering and measuring by the
record's tile and bucketing by the record's owner.

### 4.3 Other unit-AI reads

`bestUnitToAttack` with a current attack target and other candidates skips
the current target unless its tile is visible (0x0F) to the unit's player
and it is in range or reachable (`src/aiuaimod.cpp:1286-1300`).

## 5. Rules that read visibility

- `ready_to_attack` (`src/act_atak.cpp:465-477`, combat.md §3.4 step 3): a
  target owned by a player ≥ 1 that is neither a building (group 3) nor a
  wall (27) must be on a tile visible to the attacker's player, or fogged with
  the target master's `fog_flag` (dat `fogVisibility`) non-zero; otherwise
  the attack goes to state 13 and returns not ready.
- `check_placement` with `check_vis` (`src/m_s_obj.cpp:959-989`): after the
  terrain test of each footprint tile, at least one tile must be non-black
  for the player, else reason 5. The build command (`src/tcommand.cpp:324`)
  and the trained-unit placement `place_obj` (`src/stat_obj.cpp:2521`) pass
  it; map generation does not.

## 6. Player creation and the end of the player update

- `TRIBE_Player`'s constructor (Gaia's too) sets
  `fog_update = rand() * 3 / 0x7fff + 3` (`src/tplayer.cpp:265`). Nothing
  reads the value. In the original this draw sits in `new_game` after the game
  seed and before the start objects. The port's `randomSeed` is **the stream
  state after player creation**: the World draws `fog_update` before seeding
  its setup with `randomSeed` (so `World({players: 3}).fogUpdate` is
  `[3, 4, 3]` from the RNG's initial state). A byte-for-byte comparison
  against the original must shift by these draws (one per player).
- `TRIBE_Player::update` ends with a fence around the computer-player AI
  (`src/tplayer.cpp:607-631`): `r = rand()`, AI update, `srand(r)`. Gaia's
  update (`TRIBE_Gaia::update`) does not run it. See core.md §1.2 and §4.3.

## 7. Vectors

Each has a test of the same name in `packages/sim/src/visibility.test.ts`
(the fence vector is in `rng.test.ts`). Map 0-based tiles; 3 players
(Gaia, 1, 2) unless said.

- **V1** Shapes: radius 4 rows `|dy|` 0, 1 → ±4; 2, 3 → ±3; 4 → ±1. Square
  radius 2 is the 4×4 block `-2..1`. Tiles: r 4/5/8/10 → 61/97/221/349.
  The derived distance table equals unit-ai.md §3.2.
- **V2** Villager (LOS 4) of player 1 at (10.5, 10.5): player 1 explored 61,
  players 0 and 2 none; (14, 10) and (13, 13) visible, (15, 10) and (14, 13)
  black; count 1 at (10, 10); cell = bit 1 | bit 17.
- **V3** It moves to (11.5, 10.5): explored 70; (6, 10) fogged with byte 0;
  (15, 10) visible. Moving on to (11.9, 10.2) changes nothing.
- **V4** Two Villagers on (10, 10): count 2; one moves to (20.5, 10.5):
  count 1, still visible.
- **V5** Barracks (radii 1.5, LOS 5) created for player 1 at (20.5, 20.5):
  footprint 19..21 × 19..21 explored (9 tiles), (22, 20) black. Built
  (`build(10000)`): explored 97, count 1 at (20, 20), (25, 20) visible.
- **V6** The Villager of V2 at 0 hp: once dying, count 1 at (10, 10) (radius
  0.2 footprint), 0 at (11, 10), explored still 61; once removed, (10, 10)
  fogged with byte 0.
- **V7** Barracks foundation at (30.5, 30.5) for player 1 on an unexplored map:
  reason 5; without `check_vis`: 0; after player 1 explores tile (29, 29): 0
  (player 2 still 5, and its build command creates nothing).
- **V8** Clubman (1) at (10.5, 10.5), Villager (2) at (13.5, 10.5): the Clubman
  auto-attacks it within 60 turns and player 1's group-4 list holds it. With
  player 1's sight of the 3×3 around the Villager removed before any update,
  player 1 never records it and after 60 turns the Clubman has no attack and
  the Villager has 25 hp.
- **V9** Player 1's Town Center (LOS 7) at (10.5, 10.5) and Clubman at
  (21.5, 10.5), player 2's Villager at (14.5, 10.5). After one turn the
  Villager moves to (17.5, 10.5) (visible to player 1). After another turn
  player 1's record is still `(3, 14, 10)` and the Clubman's
  `bestUnitToAttack` is -1. Starting at (17.5, 10.5) instead, it is 3.
- **V10** Clubman (1) at (10.5, 10.5), Villager (2, fog_flag 0) at
  (11.5, 10.5), player 1's 3×3 around (11, 10) unexplored to fogged: an
  attack order ends in attack state 13, the Villager keeps 25 hp.
- **V11** Watch Tower (LOS 8) of player 1 at (20.5, 20.5): explored 221,
  (30, 20) black. Effect 91 (+2 LOS) or effect 15 (copy to Guard Tower,
  LOS 10): explored 349, (30, 20) visible, counts 1 at (20, 20) and (28, 20).
- **V12** `fog_update` of a new 3-player World: `[3, 4, 3]`.
- **Fence** (core.md §4.3): a 3-player World from `random_seed = 14` with no
  other draws stores 3490, 16577, 14304 after its first three steps.
