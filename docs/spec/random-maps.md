# Random map generation

Source: aoe1-decomp @ `6d6d8b1` (July 1998 RoR beta; see `README.md` for the
version caveat and reference format). Status letters: M matching,
D accepted_drift, L accepted_logic, N nonmatching. The RNG is `core.md` §4
(MS LCG, `rand()` returns 15 bits). Real values are from the captain's
`data2/empires.dat` read with `@aoe/data` (`AOE1_DIR=/Users/erics/Downloads/AOE1`).

The game path is `TRIBE_RMM_Database_Controller` (`src/rmm_tdbc.cpp`) on top
of `RGE_RMM_Database_Controller` (`src/rmm_dbct.cpp`), which runs up to six
generator modules (land, shallows, elevation, cliffs, terrain, objects).
Two files the brief pointed at are **not on this path**:

- `src/fractal.cpp` (`PointMaker`): no file outside `fractal.cpp` constructs or
  calls it (search of `src/` and `include/` finds only a forward declaration
  in `include/game_types.h:104`). Dead code for this spec.
- `src/rmm_cntr.cpp` (`RGE_RMM_Controller`): no constructor call outside its
  own file. Dead code. Its two L functions do not matter.

The functions that matter and are only L/N: `calc_land_start`,
`RGE add_land_module`, `RGE add_terrain_module`, `TRIBE add_terrain_module`,
`TRIBE add_object_module` (L); `Land::check_terrain_and_zone`,
`Land::base_land_generate`, `Elevation::generate`,
`Elevation::base_elevation_generate`, `Shallows::make_tribe_connections`,
`randomize_stack`, the 6-argument `find_path`, `place_objects`,
`place_cluster`, `create_terrain_object` (L); `Land::chance`,
`Terrain::check_terrain`, `Elevation::check_start_elevation`,
`Elevation::check_elevation`, `Elevation::link_stack_randomly`,
`place_avoid_objects`, `place_terrain_object` (N). The world entry
`RGE_Game_World::new_game` is N, `TRIBE_World::new_game` L.

## 1. Functions and status

| function | ref | status | role |
| --- | --- | --- | --- |
| `RGE_Game_World::new_game` | `src/world.cpp:983-1083` | N | seeds the world RNG, calls `new_random_game` |
| `RGE_Game_World::new_random_game` | `src/world.cpp:1143` | M | calls `map_generate2`, 3 player updates |
| `RGE_Map::map_generate2` | `src/map.cpp:1159` | M | map seed, three `srand(seed)`, init, generate |
| `TRIBE_RMM_Database_Controller::init` | `src/rmm_tdbc.cpp:27` | M | RGE init, then cliff decision |
| `RGE_RMM_Database_Controller::init` | `src/rmm_dbct.cpp:268` | M | land, terrain, object, elevation set-up |
| `RGE_RMM_Database_Controller::calc_land_start` | `src/rmm_dbct.cpp:299` | L | land centres |
| `RGE_RMM_Database_Controller::add_land_module` | `src/rmm_dbct.cpp:428` | L | land table, team re-ordering |
| `TRIBE_RMM_Database_Controller::add_land_module` | `src/rmm_tdbc.cpp:113` | M | walls, zones, shallows |
| `RGE_RMM_Database_Controller::add_terrain_module` | `src/rmm_dbct.cpp:640` | L | terrain table, hot spots |
| `TRIBE_RMM_Database_Controller::add_terrain_module` | `src/rmm_tdbc.cpp:229` | L | clump scaling, forest variant |
| `RGE_RMM_Database_Controller::add_object_module` | `src/rmm_dbct.cpp:688` | D | object table, land points |
| `TRIBE_RMM_Database_Controller::add_object_module` | `src/rmm_tdbc.cpp:278` | L | nomad, lake, islands, exclusion |
| `RGE_RMM_Database_Controller::add_elevation_module` | `src/rmm_dbct.cpp:744` | M | fixed 4-level elevation table |
| `TRIBE_RMM_Database_Controller::add_elevation_module` | `src/rmm_tdbc.cpp:423` | M | random elevation scale |
| `TRIBE_RMM_Database_Controller::add_shallows_module` | `src/rmm_tdbc.cpp:435` | M | creates shallows module |
| `TRIBE_RMM_Database_Controller::generate` | `src/rmm_tdbc.cpp:446` | M | runs modules, terrain 16 → 0 |
| `RGE_RMM_Database_Controller::generate` | `src/rmm_dbct.cpp:259` | M | creates 4 modules, runs list |
| `RGE_Random_Map_Module::generate` | `src/rmm_base.cpp:76` | M | sort by schedule, run each |
| `RGE_Random_Map_Module::push_stack` / `pop_stack` | `src/rmm_base.cpp:292`, `:316` | M / M | priority list |
| `RGE_Random_Map_Module::randomize_stack` | `src/rmm_base.cpp:371` | L | shuffle (cliff sites) |
| `RGE_Random_Map_Module::find_path` (6 args) | `src/rmm_base.cpp:409` | L | A*-like search (shallows) |
| `RGE_RMM_Land_Generator::generate` | `src/rmm_land.cpp:17` | M | land growth driver |
| `RGE_RMM_Land_Generator::check_terrain_and_zone` | `src/rmm_land.cpp:27` | L | neighbour count / conflict |
| `RGE_RMM_Land_Generator::chance` | `src/rmm_land.cpp:90` | **N** | wall-fade rejection chance |
| `RGE_RMM_Land_Generator::base_land_generate` | `src/rmm_land.cpp:142` | L | grow lands |
| `RGE_RMM_Shallows_Generator::generate` | `src/rmm_shal.cpp:17` | M | connect lands with shallows |
| `RGE_RMM_Shallows_Generator::make_tribe_connections` | `src/rmm_shal.cpp:65` | L | one shallows path |
| `RGE_RMM_Elevation_Generator::generate` | `src/rmm_elev.cpp:18` | L | 4 elevation passes |
| `RGE_RMM_Elevation_Generator::base_elevation_generate` | `src/rmm_elev.cpp:318` | L | one level |
| `RGE_RMM_Elevation_Generator::link_stack_randomly` | `src/rmm_elev.cpp:262` | **N** | random seed order |
| `RGE_RMM_Elevation_Generator::check_start_elevation` / `check_elevation` | `src/rmm_elev.cpp:54`, `:102` | **N** / **N** | site tests |
| `RGE_RMM_Elevation_Generator::remove_area_from_lists` | `src/rmm_elev.cpp:290` | M | clump spacing |
| `RGE_RMM_Cliffs_Generator::generate` | `src/rmm_clif.cpp:15` | M | all cliff functions are M |
| `RGE_RMM_Cliffs_Generator::setup_cliff_maps` / `generate_cliff` | `src/rmm_clif.cpp:30`, `:136` | M / M | sites, walk |
| `RGE_RMM_Cliffs_Generator::check_for_valid_cliff_site` | `src/rmm_clif.cpp:235` | M | direction step |
| `RGE_RMM_Terrain_Generator::generate` | `src/rmm_terr.cpp:24` | M | per-terrain passes, beach |
| `RGE_RMM_Terrain_Generator::base_terrain_generate` | `src/rmm_terr.cpp:328` | M | one terrain row |
| `RGE_RMM_Terrain_Generator::check_terrain` | `src/rmm_terr.cpp:112` | **N** | site test |
| `RGE_RMM_Terrain_Generator::check_borders` | `src/rmm_terr.cpp:65` | M | land next to water → beach |
| `RGE_RMM_Object_Generator::generate` | `src/rmm_obj.cpp:44` | M | terrain objects, then rows |
| `RGE_RMM_Object_Generator::make_placement_stack` | `src/rmm_obj.cpp:98` | D | candidate order |
| `RGE_RMM_Object_Generator::place_land_objects` | `src/rmm_obj.cpp:372` | M | rows tied to a land |
| `RGE_RMM_Object_Generator::place_objects` | `src/rmm_obj.cpp:314` | L | rows anywhere |
| `RGE_RMM_Object_Generator::place_avoid_objects` | `src/rmm_obj.cpp:251` | **N** | rows away from lands |
| `RGE_RMM_Object_Generator::place_group` / `place_cluster` | `src/rmm_obj.cpp:469`, `:512` | M / L | group shapes |
| `RGE_Map::create_terrain_object` | `src/map.cpp:1643` | L | trees/decor per tile |
| `RGE_Map::clean_terrain` / `clean_elevation` | `src/map.cpp:843`, `:709` | M / M | smoothing (no RNG) |
| `TRIBE_Map::make_new_cliff` | `src/tmap.cpp:381` | M | cliff piece object |
| `TRIBE_World::new_game` relic/ruin block | `src/tworld.cpp:659-779` | L | extra gaia objects |

## 2. Inputs

### 2.1 Game settings

- **Map size** → square side: Tiny 72, Small 96, Medium 120, Large 144,
  Huge 200, Humongous 250 (`include/tribegam.h:35-40`, applied by
  `TRIBE_Game::setMapSize`, `src/tribegam.cpp:3611-3633`).
- **Map type** (`include/tribegam.h:109-119`): 0 AllWater, 1 MostlyWater,
  2 WaterAndLand, 3 MostlyLand, 4 AllLand, 5 Continental, 6 Lake, 7 Hilly,
  8 Isthmas. The retail menu names (Small Islands, Large Islands, Coastal,
  Inland, Highland, Continental, Mediterranean, Hill Country, Narrows) are
  matched by order only: *inferred*.
- **Player count** `n` = world `player_num - 1` (Gaia excluded,
  `src/world.cpp:1156`).
- **Randomize positions** option: `fixed_positions = !randomizePositions()`
  (`src/rmm_tdbc.cpp:32`). **Starting age** Nomad changes rows (§4.3).
- Team alliances set in `new_game` *before* the map
  (`src/world.cpp:1012-1030`) feed the land re-ordering (§4.1 step 5).

### 2.2 `empires.dat` random-map tables

The controller reads `map_num` entries and indexes them **by array position
= map type** (`maps[map_type]`, e.g. `src/rmm_dbct.cpp:429`); the stored
map id is never consulted. In the captain's dat the array order of stored ids
is 4, 0, 6, 5, 7, 8, 2, 3, 1, 9, so map type 0 uses the entry whose id is 4.

Field names, decomp → `@aoe/data` (`packages/data/src/types.ts`):

| decomp (`include/rmm_dbct.h`) | `@aoe/data` | used as |
| --- | --- | --- |
| `map_edge_buffer[0..3]` | `borderSouthWest`, `borderNorthWest`, `borderNorthEast`, `borderSouthEast` | wall lines 1..4 |
| `map_edge_fade` | `borderUsage` | wall fade |
| `land_placement_edge` | `waterShape` | edge for land centres |
| `base_terrain` | `baseTerrain` | filler terrain |
| `grown_land_percent` | `landCoverage` | % of map that is land |
| land `land_avoidance_tiles` | `landSpacing` | land-to-land gap |
| land `base_square_radius` | `baseSize` | initial square half-size |
| land `zone`, `placement_type`, `x`, `y` | `zone`, `placementType`, `baseX`, `baseY` | |
| land `amount_of_land_used_percent` | `landProportion` | share of land tiles |
| land `by_player_flag` | `byPlayerFlag` | 0 one land; 1 per player, shared zone; 2 per player, own zone |
| land `radius`, `fade` | `startAreaRadius`, `terrainEdgeFade` | hot spot |
| terrain `terrain_percent`, `spacing`, `base_terrain_type`, `clumpiness_factor` | `proportion`, `edgeSpacing`, `placementTerrain`, `clumpiness` | |
| object `object_number_varience`, `number_of_groups` | `fluctuation`, `groupsPerPlayer` | |
| object `land_id`, `land_inner_radius`, `land_outer_radius` | `setPlaceForAllPlayers`, `minDistanceToPlayers`, `maxDistanceToPlayers` | |

The dat's elevation lists are all empty (0 rows in every map) and are not
used: the elevation table is hard-coded (§4.4).

Real values per map type (array index = type):

| type | stored id | edge buffers | fade | placement edge | base terrain | land % | land gap | by-player | hot radius / fade |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 4 | 9,9,9,9 | 25 | 10 | 1 | 30 | 10 | 2 | 10 / 25 |
| 1 | 0 | 6,6,6,6 | 33 | 10 | 1 | 50 | 8 | 2 | 12 / 20 |
| 2 | 6 | 5,5,5,5 | 50 | 10 | 1 | 60 | 6 | 1 | 16 / 15 |
| 3 | 5 | 5,5,5,5 | 33 | 10 | 1 | 80 | 4 | 1 | 16 / 15 |
| 4 | 7 | 0,0,0,0 | 0 | 10 | 1 | 100 | 3 | 2 | 16 / 15 |
| 5 | 8 | 20,20,20,20 | 30 | 30 | 1 | 40 | 4 | 2 | 10 / 25 |
| 6 | 2 | 0,0,0,0 | 0 | 10 | 1 | 100 | 6 | 2 (zone 1) | 10 / 25 |
| 7 | 3 | 5,5,5,5 | 33 | 10 | 0 | 100 | 2 | 2 | 16 / 15 |
| 8 | 1 | 15,15,15,15 | 30 | 30 | 1 | 45 | 6 | 2 | 10 / 25 |
| 9 | 9 | 0,0,0,0 | 0 | 10 | 1 | 100 | 2 | 2 | 16 / 15 |

Every map has exactly one land row: land id 1, terrain 0 (grass), base
radius 7, placement type 2, 100 %, clumpiness 8, zone 0 (type 6: zone 1).
Terrain rows (percent, terrain, clumps, spacing, base terrain, clumpiness)
for every type except 7: (20, 6 desert, 8, 1, 0, 20), (3, 13 palm desert,
3, 3, 6, 20), (7, 10 forest, 9, 3, 0, 20), (3, 20 jungle, 2, 3, 0, 20),
(3, 19 pine forest, 2, 3, 0, 20), (100, 22 deep water, 12, 3, 1, 20).
Type 7: (10, 6, 4, 1, 0, 20), (1, 13, 2, 3, 6, 20), (4, 10, 3, 3, 0, 20),
(1, 20, 2, 3, 0, 20), (10, 19, 12, 3, 0, 20). Object rows: 24 (types 0, 1,
5) or 28 (others); dump them with the script idea in §11.

### 2.3 Terrain records used

`RGE_Map::create_terrain_object` places each terrain's object list
(`terrainUnitIds`, `terrainUnitDensities`, `terrainUnitCentering`). Real
values: grass (0) has 28 types (densities 10, 10, 0, 0, 10, 0, 10×4, 5×8,
0×3, 1×7); water (1) 8 fish-type ids at 5; beach (2) 12 types; forest (10)
ids 393, 142, 143, 147, 195, 365, 366, 367 with densities 50, 50, 150,
100, 100, 250, 500, 1000, all centred; palm desert (13) and jungle (20) ids
113, 114, 121, 129 at 150, 150, 800, 1000; pine forest (19) 13 ids,
densities ending 250, 333, 500, 1000. `impassableTerrain` (grass 16,
water 15, desert 14) is used by `check_terrain`.

## 3. Order of operations

`map_generate2` (`src/map.cpp:1159-1184`, M):

1. `seed = random_map_seed` (command line, `src/basegame.cpp:1383`), or one
   `rand()` if it is -1 (`src/map.cpp:1163-1165`).
2. `srand(seed)`; `clear_map` with width -1 (`src/map.cpp:1170-1171`):
   `new_map` returns early for a non-positive size, and the terrain fill
   clamps to tile (0,0) with no object owner, so nothing changes and no RNG
   is used (`src/map.cpp:220-233`). The map already exists from
   `new_game` (`src/world.cpp:999`): all tiles terrain 0, height 1
   (`src/map.cpp:275-280`).
3. `srand(seed)`; `random_map->init(...)` (`src/map.cpp:1173-1174`): §4.
4. `srand(seed)` **again** (`src/map.cpp:1176`); `generate()`; `de_init()`:
   §5. The parameter draws of step 3 are therefore *not* a prefix of the
   generation stream; both start from the same seed.
5. One more `rand()`, only logged (`src/map.cpp:1180`) but it advances the
   stream that `new_random_game` continues with (`src/world.cpp:1160`).

## 4. Init: parameter set-up (`TRIBE ... ::init`, `src/rmm_tdbc.cpp:27`)

`RGE init` (`src/rmm_dbct.cpp:268-281`) runs, in order: map info, shared
search map and node grid (one node per tile, `src/rmm_base.cpp:167-197`),
`add_land_module` → `add_terrain_module` → `add_object_module` →
`add_elevation_module` (the TRIBE overrides, each of which calls the RGE
version first). Then the cliff decision (§4.5).

### 4.1 Lands (`src/rmm_tdbc.cpp:113-227`, `src/rmm_dbct.cpp:428-637`)

1. Continental (5) / Isthmas (8) with width < 100: placement edge is
   temporarily 25 (width ≥ 80) or 20 (`src/rmm_tdbc.cpp:114-119`), restored
   after step 5.
2. Land count: each by-player row gives `n` lands, others 1. Walls:
   `wall1 = buf[0]`, `wall2 = buf[1]`, `wall3 = W - buf[2]`,
   `wall4 = H - buf[3]`, fade = `map_edge_fade` (`src/rmm_dbct.cpp:444-448`).
   `land_tile_num = land% × W × H / 100` (integer).
3. Per row, `calc_land_start` (below) then each land gets: terrain, area =
   land gap, base size, zone (row zone if by-player 1, else the player
   index), `land_size = pct × land_tile_num / (n × 100)` (by-player) or
   `/ 100`, clumpiness, the walls (`src/rmm_dbct.cpp:450-488`).
4. **`calc_land_start(first, edge, count)`** (`src/rmm_dbct.cpp:299-426`, L):
   - one logged draw (`:317`).
   - `r = (W − 2·edge) / sqrt(count)` as float; × 0.9 if 4..6 lands,
     × 0.8 if ≥ 7. `bound = r²` (float).
   - Centre box: `minX = trunc(W/2 − 0.9·r)`, `maxX = trunc(W/2 + 0.9·r)`
     (same for Y with H); then `min ≤ edge → edge + 1`,
     `max ≥ W − edge − 1 → W − edge − 2` (`:327-340`).
   - Placement 0: each land `x = rand·(W−2e)/32767 + e`, then
     `y` likewise with H (`:349-350`). Placement 1: the row's x, y.
   - Placement 2 (every real map): for each land draw x then y as in type 0
     (`:380-381`) until accepted. Reject if strictly inside the centre box
     (`minX < x < maxX` and `minY < y < maxY`). Otherwise compare with the
     earlier lands of this call, in order; reject if
     `(float)(dx² + dy²) ≤ bound`. **Quirk:** if the land too close is the
     immediately previous one, that previous land is first *moved* to the
     rejected point (`:398-403`). Then retry.
5. If `fixed_positions`: re-order land centres by team
   (`src/rmm_dbct.cpp:490-637`): per land, the other lands sorted by
   squared distance (bubble sort); teams from `players[i+1].relation(j+1)
   == ALLY` (self is NEUTRAL, `src/player.cpp:129`, so a team's size is its
   allies + 1); each team claims its nearest unclaimed lands, with a swap
   step if they are taken; finally land `i` gets the centre claimed by the
   `i`-th player's team. With 2 players and no alliance every land keeps its
   own centre (traced by hand; *inferred* for 3+ players because the
   function is L).
6. Walls (map type < 5): 4 draws (`src/rmm_tdbc.cpp:126`, `:131`, `:136`,
   `:141`); each `< 0x3FFF` opens one wall (wall1/2 → −1, wall3 → W,
   wall4 → H) for the land table and every land.
7. Isthmas: one draw (`:149`): `< 0x3FFF` opens walls 1 and 3, else 2 and 4.
8. Types 2..6 and 8: draw (`:168`). If `< 0x3FFF`: draw (`:169`) → even
   lands get zone 0 if `< 0x3FFF`, else zone = own index; draw (`:176`) →
   odd lands zone 1 or own index; then `add_shallows_module` (one logged
   draw, `:443`). Else, AllLand (4): all zones 0 and **base terrain 0**
   (no water at all); else type ≥ 5: all zones 0 (`:166-196`).
9. Continental / Isthmas: on a map under 100 tiles the closed walls move
   to `edge` from the border (15 if the width is ≥ 80, else 10); a wider map
   keeps its walls and only uses edge 20 for the size below
   (`src/rmm_tdbc.cpp:196-216`: the wall moves sit inside `if (width < 100)`).
   Every land's size
   becomes `trunc((W−2·edge)(H−2·edge) × 0.8) / land_num`
   (`src/rmm_tdbc.cpp:194-224`, factor `g_rmm_terrain_land_area_factor`,
   `src/game_globals.cpp:296`).
10. One logged draw (`:226`).

### 4.2 Terrain table (`src/rmm_dbct.cpp:640-686`, `src/rmm_tdbc.cpp:229-276`)

- `land_area = W × H × land% / 100`; per row
  `terrain_size = trunc(pct × land_area × 0.01f)`, copies of type, clumps,
  spacing, base type, clumpiness, `avoid_hot_spots = 1`.
- Hot spots, one per land (row by-player: `n` of them) with radius ≥ 0:
  position of land `k` (same running index), radius and fade from the row.
- TRIBE: `ratio = land_tile_num × 0.00005f`; if `ratio > 1.0`, every row
  except terrain 6 gets `clumps = trunc(clumps × ratio)` (`:235-241`).
- Draw (`:243`). If `< 0x1FFF` (1 in 4) the **forest variant**: terrain 13
  size ×3, clumps ×3, avoid 2; 20 and 19 size /2, clumps /2; 10 size /2,
  clumps /2, avoid 2; 6 size ×2, avoid 0. Else: 6 avoid 0; 10 and 13 avoid 2.
- One logged draw (`:275`).

### 4.3 Object table (`src/rmm_dbct.cpp:688-742`, `src/rmm_tdbc.cpp:278-421`)

- Rows copied from the dat with `object_exclusion_zone = 1`. Land points:
  one per land with the dat land id and `player_id` 1..n for by-player
  lands, 0 otherwise.
- One discarded draw (`src/rmm_tdbc.cpp:282`).
- Nomad: rows for the villager (`MASTER_OBJECT_MAN`) get 1 group; town
  centre rows 0 groups.
- Lake (6): all lands shift up one; new land 0 is a water lake at the map
  centre: terrain 1, area 7, base 2, zone = old land count, size
  `trunc((H−2e)(W−2e) × 0.7)` with `e = W/6`, clumpiness 10, walls at `e`,
  fade 10 (`:295-317`).
- Types 0 and 1 (islands): `count = rand·4/32767 + 1` (`:320`), capped so
  `count + n ≤ 10`; every land loses `(W+H)·count/land_num` tiles. Per extra
  island: terrain 0, area 7, base 3, own zone, size
  `trunc((W+H) × 1.25)`, clumpiness 10, table walls; centre by up to 1000
  tries of x, y draws (`:349-350`, range 8..W−8) that keep ≥ 20 tiles
  (d² ≥ 400) from the **original** lands only; after 1000 failed tries
  `count` is cut to the current index (the current island is still
  written). Each island also adds an object row: one cluster of 8, area 4,
  gaia, outer radius 26, stone mine (102) if a draw (`:378`) `< 0x3FFF`,
  else gold mine (66); and a land point.
- Exclusion zones (`:393-418`): land rows (land id ≥ 0) of berries 59,
  gazelle 65, gold 66, stone 102 get 12; avoid rows (land id −2): gazelle
  `W/8`, berries, gold and stone `W/6`.
- One logged draw (`:420`).

### 4.4 Elevation table (`src/rmm_dbct.cpp:744-799`, `src/rmm_tdbc.cpp:423-433`)

Fixed four levels on grass (base terrain 0), with
`land_area = W × land% × H / 100`:

| level | height | from height | clumps | spacing | size |
| --- | --- | --- | --- | --- | --- |
| 0 | 1 | 0 | 10 | 2 | land_area × 10 / 100 |
| 1 | 2 | 1 | 8 | 1 | land_area × 8 / 100 |
| 2 | 3 | 2 | 6 | 1 | land_area × 6 / 100 |
| 3 | 4 | 3 | 4 | 1 | land_area × 4 / 100 |

Hot spots as for terrain. TRIBE: one draw `r` (`src/rmm_tdbc.cpp:425`),
`scale = (70 + r × 0.0018311106) × 0.01` in float (≈ 0.70 … 1.30; the
constants are `src/game_globals.cpp:301-304`), ×5 for Hilly; every size
becomes `trunc(size × scale)`. Then one logged draw (`:432`).

### 4.5 Cliffs decision (`src/rmm_tdbc.cpp:35-104`)

One draw; cliffs only if `> 0x1FFF` (3 in 4). By width: ≤ 72 → count 3,
length 10; ≤ 96 → 4, 12; ≤ 120 → 6, 14; ≤ 144 → 8, 16; ≤ 200 → 18, 20;
≤ 250 → 28, 20. By type: AllWater 0/0; MostlyWater count −5, length −6;
WaterAndLand −3, −2; Continental, Lake, Isthmas length −4. Length floor 3.
Then `size_variance = (length − 3) / 2` (0 if ≤ 0),
`average = length − size_variance`; spacings 2 and 2;
`number_of_cliffs_variance = 2` is set but never read. Module created only
if `average > 0` and count `> 0` (a negative count skips it).

## 5. Generate (`src/rmm_tdbc.cpp:446`, `src/rmm_dbct.cpp:259`, `src/rmm_base.cpp:76`)

Four modules are created now (terrain, land, objects with terrain objects
on, elevation); shallows and cliffs were created in init. Each new module
is pushed at the head of the controller list; `generate` insertion-sorts by
`schedule` ascending (ties keep list order) and runs:

| schedule | module | present |
| --- | --- | --- |
| 1.0 | land (`src/rmm_land.cpp:11`) | always |
| 1.1 | shallows (`src/rmm_shal.cpp:12`) | §4.1 step 8 |
| 1.5 | elevation (`src/rmm_elev.cpp:15`) | always |
| 1.75 | cliffs (`src/rmm_clif.cpp:12`) | §4.5 |
| 2.0 | terrain (`src/rmm_terr.cpp:21`) | always |
| 3.0 | objects (`src/rmm_obj.cpp:23`) | always |

One logged draw before the first module (`src/rmm_base.cpp:101`) and one
after each module (`:112`). Modules copy their info at construction, so
later edits to the controller tables do not reach them. After all modules,
every tile of terrain 16 becomes 0 (`src/rmm_tdbc.cpp:448-455`).

### 5.1 Shared priority list

One node per tile; a node is in at most one list (pushing it anywhere first
unlinks it, `src/rmm_base.cpp:292-314`). `push(cost)` inserts before the
first node whose cost is ≥ the new cost, so equal costs pop **newest
first**; `pop` takes the head (lowest cost).

### 5.2 Land (`src/rmm_land.cpp:17-311`)

1. Search map filled with `land_num` ("free"); whole map set to the base
   terrain without objects; then `base_land_generate`; then
   `clean_terrain(base terrain)` (`:19-23`).
2. Per land in index order: clip the square `centre ± base_size`, paint it
   the land terrain, mark it with the zone, push its four outside edges
   (left column, top row, right column, bottom row; cost 0).
   **Quirk:** the grown counter is set at index `zone`, not land index
   (`:182-183`); with a shared zone (by-player 1) land 0 starts at the
   square area and land 1 at 0.
3. Round-robin over lands until nothing changes: if a land's counter <
   its `land_size` and its list pops a tile: draw `r` (`:235`); if
   `chance(x, y) > r·100/32767` mark the tile 255 (blocked). Else
   `count = check_terrain_and_zone`; if the tile is still free and
   `count > 0`, paint it, mark the zone, and for each free 4-neighbour in
   order left, right, up, down draw (`:248`, `:253`, `:258`, `:263`) and
   push with cost `r·100/32767 − count × clumpiness + 250`; counter + 1.
4. Leftover list tiles get the land terrain if both left/right or both
   up/down neighbours have the land's zone.

`check_terrain_and_zone` (L): 0 if the tile is not free or any tile within
the `area` square is another land's zone (< `land_num`, ≠ own zone);
otherwise the number of own-zone tiles in the 5×5 window, plus 5 per
off-map row and 1 per off-map column inside that window (the edge tests
are strict, `:52-81`). `chance` (N) is the decomp body taken literally,
checked against the retail `Empiresx.exe` 1.0a (`0x4710a0`, same
instructions): `xc = max(wall1 − x, x − wall3)`;
`a = max(2·wall1 − x, x + W − 2·wall3)`; if `a > 0` the y term is
`max(wall2 + a − y, a − wall4 + y)`, else `max(wall2 − y, y − wall4)`;
result `(max(xc, 0) + max(y term, 0)) × fade`, ≥ 100 → 101, fade 0 → 0.
Near an x wall the y term picks up the x distance: with walls (5, 5, 91, 91),
fade 33, W 96, tile (3, 7) gives 101 where the "distance outside the walls"
reading gives 66 (test `rmm-land.test.ts`).

### 5.3 Shallows (`src/rmm_shal.cpp:17-212`)

Captured land centres at init. For every pair `i < j` connect `i → j`;
then twice: pick two random non-water tiles (x then y draws, `:36-37`,
`:48-49`, retry while water 1, 4 or 22) and connect them. A connection runs
`find_path` with costs grass 1, water 7, beach 1, shallows 2, deep water 14
(others impassable), walks back from the target, and for each path tile that
is water (1 or 22) draws four widths (`:148`, `:153`, `:158`, `:163`:
`x − (r·2/32767) − 1`, `y − …`, `x + … + 1`, `y + (r·3/32767) + 1`) and
queues all water in that box; land path tiles queue their water
4-neighbours. All queued tiles become shallows (4).

### 5.4 Elevation (`src/rmm_elev.cpp:18-449`)

All heights set to level 0's `from height` (0); hot-spot modifier map
(§5.6); then per level: `base_elevation_generate`, then
`clean_elevation(…, 8)` (`:45`).

Per level: `link_stack_randomly` links every tile in row-major order, then
`W·H/16` times draws col then row (`:284-285`, `rand·(W−1)/32767`) and
moves that tile to the head. `area = max(2, trunc(sqrt(size/clumps)) / 2)`.
Seeds: pop until `clumps` accepted: modifier 0 and the `spacing` square is
all base terrain at ≥ from-height; accept → unlink the `area` square
(**bug:** the row loop ends at the clamped *x* bound, `:306`), set height,
push 4 neighbours to this clump's list. Growth: round-robin clumps while
total < size: pop, draw `r` (`:398`); if `modifier ≤ r·100/32767` and the
tile is at from-height with a non-zero `check_elevation` count (tiles of the
target height in 5×5, after the spacing test), raise it and push equal-height
neighbours (left, right, up, down; draws `:411-423`) at
`r·100/32767 + 250 − 15·count`. If the modifier test fails instead, the
tile's modifier is set to 101 (never tried again).

### 5.5 Cliffs (`src/rmm_clif.cpp`)

Works on a 3×3-tile grid (`W/3` cells). A cell is a site if all 9 tiles are
grass or desert at one height (value height + 1); a cell touching water
blocks cells within `cliff_terrain_spacing`. Cells near hot spots
(`radius/3 + 2`) and isolated sites are dropped; sites shuffled by
`randomize_stack` (2 passes, one draw per node, `src/rmm_base.cpp:382`,
`j = r·100/32767`; **bug:** `r = 32767` gives bucket 100, one past the
array: the node leaves the list and is never gathered back, see §12.3). Then one draw (`src/rmm_clif.cpp:19`) and per cliff:
size `r·2v/32767 + average − v` (`:149`; stop if < 3 or no sites); pop a
live site; direction `r·4/32767` (`:180`); per step draw (`:185`):
value < 18 → direction − 1 (0 wraps to 3), < 36 → + 1 (3 wraps to 0); try direction, +1, −1, then (first step
only) −2. Direction wrap is not mod 4: values > 3 subtract 3 per step,
negatives add a multiple of 3 (`:242-249`), so 4 → 1 and −1 → 2. Each cliff
is painted as terrain 16 (brush 1) and cliff pieces along cell centres
`3c+1` (`:227-228`); `TRIBE_Map::make_new_cliff` may draw once
(`src/tmap.cpp:393`) and creates an object (§6).

### 5.6 Hot-spot modifier (terrain and elevation)

Per tile: `Σ fade × (radius − trunc(sqrt(dx² + dy²)))` over hot spots
with a positive term; > 100 stored as 101 (`src/rmm_terr.cpp:196-242`,
`src/rmm_elev.cpp:197-243`).

### 5.7 Terrain (`src/rmm_terr.cpp:24-568`)

Modifier map; a zone map over terrain classes; each row in order; then
`check_borders`: every non-water tile with a water (1, 4, 22) 8-neighbour
becomes beach (2). Per row: `link_stack_randomly` as in §5.4 but `W·H/8`
moves (`:287-288`); `base_area = max(2, 2 × trunc(sqrt(size/clumps)))`.
Seeds: tile of the base type, `check_terrain > 0` (N: every tile in the
spacing square is base, its impassable twin, or the target; returns
1 + target tiles in 5×5), and modifier 0 unless avoid is 0; unlink the
`base_area` square, paint, push 4 neighbours. Avoid 2 ("fairness"): keep
seeding until every hot spot's zone has a clump, accepting modifier < 30.
Growth (round-robin, total < size): pop; if avoid ≠ 0 draw (`:506`) and
require `modifier ≤ r·100/32767`; if base type and check > 0: paint, push
base neighbours (col−1, col+1, row−1, row+1; draws `:521-533`) at
`r·100/32767 + 250 − clumpiness × count (+ modifier if avoid ≠ 0)`.
Leftovers fill only horizontal gaps (the vertical test compares
`row > max`, never true).

### 5.8 Objects (`src/rmm_obj.cpp`)

1. Terrain objects: `set_terrain` over the map with Gaia as owner and
   set-flag 0 (`:51`) calls `create_terrain_object` per tile, row-major:
   per object type with density > 0, per 1000 of density: if not centred
   draw x then y offsets (`src/map.cpp:1700-1702`); if density < 1000 draw
   (`:1712`) and place if `r·1000/32767 < density_left`; place only if
   `check_placement` passes.
2. Rows in table order (`generate_objects`, `:72`): scale flag →
   `groups = max(1, W·H·groups / 20736)` (0x5100 = 144²). Land id ≥ 0:
   once per matching land point; −1: anywhere; −2: away from all lands by
   `inner radius`.
3. `make_placement_stack` (D): candidate tiles row-major in the clipped
   square (or whole map), then `(w·h)/4` random moves to the head with
   `w = x1 − x0 − 1`, `h = y1 − y0 − 1` (`:156-157`; the last column and
   row are never drawn).
4. `place_land_objects` (M): owner = row player, or the land's player when
   the row says −1; candidates must be in the land centre's zone for the
   object's terrain class, outside the inner square, on the row's terrain.
   On success unlink `exclusion` square and place by group flag (0 single,
   1 group, 2 cluster). A single object whose placement fails on the last
   candidate is placed anyway (`:460-461`).
5. `place_group`: count `per_group + r·2v/32767 − v` (`:485`), min 1.
   `place_cluster`: same count (`:547`), grows from the start tile, pushing
   free 4-neighbours at cost = a raw draw (`:573-582`).

## 6. RNG calls, in order

All draws are `rand()`; "log" draws only feed a log line but still advance
the stream. **Every object created** (cliff pieces, terrain decorations,
placed objects) runs `rand()` then `srand(that value)`
(`src/stat_obj.cpp:169-179`, the draw at line 387 of the original file). That
is one draw, but the state after it is the 15-bit value, not the 32-bit LCG
state a plain draw leaves; the sim already does `rng.srand(rng.rand())` for
object creation (`objects.ts`, `buildings.ts`).

| # | site | when | use |
| --- | --- | --- | --- |
| 0 | `src/map.cpp:1165` | seed −1 | map seed |
| — | `srand(seed)` ×2 | `src/map.cpp:1170`, `:1173` | |
| I1 | `src/rmm_dbct.cpp:317` | each `calc_land_start` | log |
| I2 | `src/rmm_dbct.cpp:380-381` | per try | x, y |
| I3 | `src/rmm_tdbc.cpp:126-141` | type < 5 | 4 walls |
| I4 | `src/rmm_tdbc.cpp:149` | Isthmas | wall pair |
| I5 | `src/rmm_tdbc.cpp:168`, `:169`, `:176`, `:443` | types 2..6, 8 | shallows, zones, log |
| I6 | `src/rmm_tdbc.cpp:226` | always | log |
| I7 | `src/rmm_tdbc.cpp:243`, `:275` | always | forest variant, log |
| I8 | `src/rmm_tdbc.cpp:282` | always | discarded |
| I9 | `src/rmm_tdbc.cpp:320`, `:349-350`, `:378` | types 0, 1 | islands |
| I10 | `src/rmm_tdbc.cpp:420`, `:425`, `:432` | always | log, elevation scale, log |
| I11 | `src/rmm_tdbc.cpp:35` | always | cliffs yes/no |
| — | `srand(seed)` | `src/map.cpp:1176` | |
| G1 | `src/rmm_base.cpp:101` | always | log |
| G2 | land, §5.2 | | |
| G3 | `src/rmm_base.cpp:112` | after each module | log |
| G4 | shallows §5.3, elevation §5.4, cliffs §5.5, terrain §5.7, objects §5.8 | in schedule order, each followed by G3 | |
| E | `src/map.cpp:1180` | always | log |

Before and after (`core.md` §4.2): `new_game` seeds with the shared seed
and draws at `src/world.cpp:995`, `:1000`, `:1006`, `:1009`;
`new_random_game` draws at `:1153` before the map and `:1160`, `:1163`,
`:1182` after (with 3 player-update rounds between). If `new_map`,
`setup_gaia` and `setup_players` draw nothing (**unverified**), the map seed
in a multiplayer game is the **6th** `rand()` after `srand(shared seed)`.
After `RGE new_game`, `TRIBE_World::new_game` may draw at
`src/tworld.cpp:730` (skipped when `victory_type == 3`) and `:734` (each
`% 100 < 50`) to add 5 relics (159) and/or 5 ruins (158) with exclusion
`W/5`, placed by a second object generator without terrain objects
(`:659-778`).

## 7. Timing in sim steps

Generation runs inside `new_game` before `world_time` starts at 0
(`src/world.cpp:1052-1053`): **zero sim steps**. Its only effects on the
running game are the map, the objects and the RNG value carried into
`random_seed` (`src/world.cpp:1160`, then `:1083`).

## 8. Constants

| name | value | ref |
| --- | --- | --- |
| map sides | 72, 96, 120, 144, 200, 250 | `include/tribegam.h:35-40` |
| octagon scale (land) | 0.666666 (computed, then unused: the window is fixed ±2) | `src/game_globals.cpp:295`, `src/rmm_land.cpp:34-38` |
| continental land factor | 0.8 | `src/game_globals.cpp:296` |
| clump ratio scale / threshold | 0.00005f / 1.0 | `src/game_globals.cpp:297-298` |
| lake land factor | 0.7 | `src/game_globals.cpp:299` |
| island size factor | 1.25 | `src/game_globals.cpp:300` |
| elevation scale | 70, −0.0018311106, 0.01, Hilly ×5 | `src/game_globals.cpp:301-304` |
| path diagonal adjust | 1.36 (−1.36 × −1), ±0.41, ±0.4 | `src/game_globals.cpp:290-294` |
| grow cost base | 250 | `src/rmm_land.cpp:249`, `src/rmm_terr.cpp:245`, `src/rmm_elev.cpp:246` |
| scale-flag area | 20736 (0x5100) | `src/rmm_obj.cpp:74` |

## 9. Worked examples (test vectors)

All for map type 3 (MostlyLand, dat index 3), width 96, 2 players, no
alliance; MS LCG from `core.md` §4.1. Recomputable with a 40-line script.

### 9.1 Example A — multiplayer seed chain

Shared seed 1: the raw stream is 41, 18467, 6334, 26500, 19169, **15724**.
With no draws in `new_map`/`setup_gaia`/`setup_players` (unverified), the
map seed is 15724. Shared seed 12345 gives 7584, 19164, 25795, 22125, 5828,
**23405**.

### 9.2 Example B — full init stream for map seed 41

`r = 76/√2 = 53.740116` (float), `bound = 2888.0`, centre box 11..84 both
axes (raw `trunc(48 ∓ 48.37)` = 0 and 96, then clamped). Draws after
`srand(41)`, in order:

| draw | site | value | effect |
| --- | --- | --- | --- |
| 1 | I1 | 172 | log |
| 2–3 | I2 | 22420, 5 | (62, 10): outside box (y = 10) → land 0 |
| 4–5 | I2 | 5992, 5768 | (23, 23) in box, reject |
| 6–7 | I2 | 8953, 4904 | (30, 21) in box, reject |
| 8–9 | I2 | 10571, 32065 | (34, 84): d² = 6260 > 2888 → land 1 |
| 10–13 | I3 | 7917, 32557, 29906, 24100 | only wall 1 opens (→ −1) |
| 14 | I5 | 23320 | ≥ 0x3FFF: no shallows module |
| 15 | I6 | 12912 | log |
| 16 | I7 | 5886 | < 0x1FFF: forest variant |
| 17 | I7 | 27138 | log |
| 18 | I8 | 28055 | discarded |
| 19 | I10 | 12520 | log |
| 20 | I10 | 28919 | elevation scale 1.2295388 |
| 21 | I10 | 30260 | log |
| 22 | I11 | 11249 | > 0x1FFF: cliffs on |

Resulting tables: lands (62, 10) for player 1 and (34, 84) for player 2,
both zone 0, `land_size = 100 × 7372 / 200 = 3686`, walls (−1, 5, 91, 91),
fade 33, base terrain water. Generation then restarts with `srand(41)`, so
its first draw (G1) is again 172.

### 9.3 Example C — the moved-land quirk (map seed 101)

| try | draws (x, y) | point | result |
| --- | --- | --- | --- |
| 1–4 | 11964, 23279 / 7999, 2051 / 15181, 27811 / 31542, 6953 | (37,63) (28,14) (45,74) (83,26) | in box |
| 5 | 32249, 23683 | (84, 64) | land 0 |
| 6 | 32549, 8945 | (85, 30) | d² to land 0 = 1157 ≤ 2888: **land 0 moves to (85, 30)**, retry |
| 7 | 292, 954 | (10, 12) | d² = 5869 → land 1 |

Final centres (85, 30) and (10, 12); 15 draws in `calc_land_start`.

### 9.4 Example D — derived parameters for seed 41

`land_area = 96·96·80/100 = 7372`; ratio 0.3686 ≤ 1 (no clump scaling).

| terrain | size from dat % | after forest variant | clumps | avoid | base_area |
| --- | --- | --- | --- | --- | --- |
| 6 desert | 1474 | 2948 | 8 | 0 | 38 |
| 13 palm | 221 | 663 | 9 | 2 | 16 |
| 10 forest | 516 | 258 | 4 | 2 | 16 |
| 20 jungle | 221 | 110 | 1 | 1 | 20 |
| 19 pine | 221 | 110 | 1 | 1 | 20 |
| 22 deep water | 7371 (see §10) | 7371 | 12 | 1 | 48 |

Elevation sizes 737, 589, 442, 294 × 1.2295388 → **906, 724, 543, 361**,
`area` 4 for every level. Cliffs: width 96 → 4 cliffs, length 12,
`size_variance 4`, average 8, so each cliff's size is `r·8/32767 + 4`
(4..12). Hot spots (62, 10) and (34, 84), radius 16, fade 15: modifier 101
up to distance 9, then 90, 75, 60, 45, 30, 15 at distances 10..15, 0 from 16.
Exclusion zones: land rows 59/65/66/102 → 12; avoid rows 65 → 12,
59/66/102 → 16. Links per pass: terrain 1152 moves, elevation 576.

### 9.5 Example E — elevation scale endpoints

| r | scale | sizes for W = 96, 80 % |
| --- | --- | --- |
| 0 | 0.70 | 515, 412, 309, 205 |
| 13328 | 0.94405 | 695, 556, 417, 277 |
| 28919 | 1.2295388 | 906, 724, 543, 361 |
| 32767 | 1.30 | 958, 765, 574, 382 |

## 10. Unverified or inferred

- `Land::chance` (N): settled by the retail check (§5.2).
- Float details: `terrain_size` for 100 % × 7372 is 7371.9998 before the
  cast if x87 keeps the product unrounded (→ 7371), 7372 if stored as float
  first. Example D assumes 7371. The elevation scale for `r = 13328`
  differs in the last float bit between "round each step" and "round once";
  sizes are unaffected there. `bound` for W = 72 is 1352.0001 as float.
- Team re-ordering for 3+ players, and `relation()` mixing land and player
  indices (only safe because every real map has one by-player land row).
- Draw-free `new_map`, `setup_gaia`, `setup_players` (Example A).
- Cliff piece selection (`TRIBE_Map::add_cliff_edge`, `cliff_master_table`)
  and `tribe_clean_terrain` (L) are not specified here.
- `clean_terrain`/`clean_elevation`/`preclean`/`postclean_elevation`
  (`src/map.cpp:530-960`) are only summarised: they smooth single-tile
  spikes and diagonal-only contacts, iterate until stable, and draw no
  random numbers. `clean_terrain` repaints through the one-tile
  `set_terrain`, which also places terrain objects for Gaia; this matters
  only if the base terrain (water) gets objects there (**unverified**).
- Which terrain-object ids Gaia's master list lacks (those are skipped
  without drawing) is unverified. The per-tile guard in the area
  `set_terrain` (`src/map.cpp:2230`: the target terrain must have a graphic
  for the tile's slope shape) is narrowed down in §12.3: it can only matter
  for a sloped shallows tile in the object module's terrain-object pass.
- Retail menu names for map types (§2.1).

## 11. Implications for the port

- **Implication:** generation is a pure function of (map seed, type, size,
  player count, alliances, randomize-positions, starting age, victory type,
  dat). `packages/sim` must run it on every client from the same seed;
  nothing needs to be sent over the network beyond the settings and seed.
- **Implication:** reproduce the RNG stream exactly, including log draws,
  the discarded draw, the double `srand(seed)`, and the rand-then-srand of
  every created object (decorations included). One missing draw changes
  every later tile.
- **Implication:** implement the shared node list (§5.1) with its exact
  tie rule and single-membership behaviour; order of equal costs decides
  shapes.
- **Implication:** keep the quirks: moved previous land, zone-indexed land
  counter, elevation spacing bug, horizontal-only terrain fill, cliff
  direction wrap, `randomize_stack` bucket 100 (needs a defined behaviour:
  the node is dropped, settled by retail check, §12.3), `make_placement_stack` never drawing the last row/column.
- **Implication:** index random-map entries by array position, not stored
  id; read field meanings from §2.2, since several `@aoe/data` names
  (`waterShape`, `borderUsage`, `setPlaceForAllPlayers`) do not describe
  their use.
- **Implication:** floats: use `Math.fround` where the decomp stores floats
  and plain double products elsewhere; flag the §10 cases in golden tests.
- **Implication:** a golden test can assert Examples B and C directly (draw
  values and land centres) before any tile logic exists; full-map hashes
  need retail recordings.
- Generation is heavy (two full-map passes per terrain and elevation row);
  it runs once at game start, so a straightforward port is fine.

## 12. Port status

### 12.1 Terrain module (`packages/sim/src/rmm-terrain.ts`)

Ported: `generate`, `generate_modifiers` (exported as `hotSpotModifiers`; the
elevation module's copy is the same computation), `check_terrain`,
`check_borders`, `link_stack_randomly`, `remove_area_from_lists` and
`base_terrain_generate` with its seed, fairness (avoid 2), growth and
horizontal-gap phases. Input: `TerrainInfo` (the rows and hot spots the
controller builds, §4.2); the controller itself is not ported. Tests:
`rmm-terrain.test.ts` (hand-built 96×96 layout with the §9.2 land centres and
the §9.4 rows).

Checked against the decomp:

- The terrain writes (`tile->terrain_type = …` in `base_terrain_generate`
  and `check_borders`) go to the 5-bit bit-field of `RGE_Tile`
  (`include/map.h:32`), and both functions are M, so the binary keeps the
  height bits. The port writes `RmmMap.terrain` only and leaves height alone
  (test "map 3 rows"). This settles the terrain/height trap for this module;
  the land module's writes are its own question.
- These writes bypass `set_terrain`: the terrain module makes no objects.
- The zone map is grass (0) against every other terrain (table `t ↦ t`, 99
  entries, `> 0` passable), built once per `generate` before the rows.
- Growth skips the pop entirely once the row has its size; the modifier draw
  happens only for avoid ≠ 0 and before the tile's terrain test; neighbours
  are pushed left, right, up, down (seeds: left, up, right, down).
- The gap fill drains only the first `clumps` lists (fairness clumps past
  that index keep their leftovers).

Unverified: `check_terrain` is N; the port follows the decomp's reading.
A row with `clumps` 0 would divide by zero for `base_area`; it never seeds,
so the value is unused.

### 12.2 Object module (`packages/sim/src/rmm-objects.ts`)

Ported: `generate` (terrain objects through `RmmMap.setTerrainArea` with
set-flag 0, `clear_stack`, rows in order, `delete_zone_maps`),
`generate_objects` (scale flag written back to the row), `add_quick_obj`,
`make_placement_stack`, `place_land_objects`, `place_objects`,
`place_avoid_objects`, `place_group`, `place_cluster`, `set_search_area`,
`remove_area_from_lists`; and the relic/ruin block of
`TRIBE_World::new_game` for a random game (`placeRelicsAndRuins`). Input:
`ObjectInfo` (rows and land points); `objectRowFromDat` turns a dat row into a
row as `RGE add_object_module` copies it (exclusion 1). The TRIBE controller's
changes (§4.3: nomad, lake, islands, exclusion zones) and the land-point
player numbering are controller work, not ported. Tests:
`rmm-objects.test.ts` (hand-built 96×96 layout: grass, a water channel with
deep water and beaches, a forest patch; lands (20, 48) and (76, 48); map 3's
dat rows with the §4.3 exclusion zones applied by hand).

Checked against the decomp:

- Every placement loop pops before testing the count, so one extra node is
  popped when the count reaches 0 (`while (pop && count > 0)`).
- Positions: tile corner plus 0.5 on each axis whose radius has a fraction.
  `check_placement` flags: flat on, construction radius on, objects on;
  "can be built on" only for land rows. Clusters snap with `alignment`.
- Land rows: the start must be in the land centre's zone for the object's
  terrain restriction, outside the open inner square, and the search map is
  0 within `inner` of every land centre (so with inner 0 only the centre
  tile is excluded). A town centre (outer 1) has no random moves (`w`, `h`
  are 1), so it lands on the first fitting tile in row order: on open ground
  `(cx − 0.5, cy − 0.5)` (test vector). A single object that fails on the
  last candidate is still placed there (test vector).
- A group's and a cluster's lists take their tiles out of the row's list
  (one list per node), and a cluster sets its square searchable first.
- The player for a negative row player is Gaia (anywhere rows) or the land's
  player (land rows, Gaia when it is 0).
- Map type 3's rows include lion 126 (avoid row, inner 18, 7 groups per
  144², group 1 ± 2) and alligator 1 on shallows (4) and beach (2).
- Terrain-object lists: the "old terrain" lookup in `create_terrain_object`
  reads one slot past the list. In the captain's dat every unused slot is 0
  (terrains 0, 1, 2, 4, 6, 10, 13, 19, 20, 22 checked with `dat:dump`), so
  the extra slot only matches objects of type 0, which the generator never
  places; `RmmMap` treating it as not found gives the same result.

Unverified or inferred:

- `place_avoid_objects` is N and `place_objects`/`place_cluster` are L; the
  port follows the decomp's reading. `place_objects` reads the master without
  a null check (the original would crash); the port throws.
- `place_land_objects` without a master returns without releasing its list;
  the port does the same, which only matters if a later list reuses the
  original's stack address (never with the dat's rows).
- Relics and ruins: the scenario's wanted artifacts, discoveries and ruins
  are the victory amounts `TRIBE_World::new_game` sets for a random game
  (`src/tworld.cpp:576-611`); the caller passes them and the count of objects
  already owned. The campaign/scenario branch is not ported.
- The area `set_terrain` per-tile shape check (`src/map.cpp:2230`) is still
  taken as always passing (`RmmMap`); the object module's terrain-object pass
  goes through it.

### 12.3 Shared resources and map operations (`rmm-base.ts`, `rmm-map.ts`)

Ported by the first crew; now tested in `rmm-base.test.ts` (list order, equal
costs, single membership, `deinit`, `randomize_stack` with scripted draws,
`find_path` marks, walls, diagonals) and `rmm-map.test.ts` (`clean_terrain`
both passes, `get_tile_type`, `clean_elevation` with pre/postclean, the two
`set_terrain` forms and terrain objects, `check_placement` 7/2/0, the TRIBE
terrain and cliff brushes, the dat's land terrains). Re-read against
`src/map.cpp`, `src/tmap.cpp` and `src/rmm_base.cpp`: all match except the one
fix below. `RmmMap` and `MapStack` are shared with the terrain and object
modules.

Checked:

- `randomize_stack` bucket 100 (`r = 32767`): in the retail exe
  (`0x46d5d0`, frame `0x968`) `sub_stacks[100]` lies over the return address
  and the caller's saved `ebp`, which is 0 there (the base generate loop at
  `0x46d060` leaves it 0). The node is linked onto that slot and so leaves the
  list; the stray writes land in dead register slots. `MapStack.randomize`
  keeps a 101st bucket that is never gathered: the node is dropped but stays
  linked to nothing live.
- Terrain-object "old terrain" lookups read `obj_types[num]`, one past the
  list, which is 0 for every terrain in the dat: object type 0 counts as
  listed. Fixed in `RmmMap.inTerrainList` (it treated the slot as not found).
- The area `set_terrain` shape guard: in the dat, terrains 0, 1, 2, 6 and
  10–22 have a frame for all 17 shapes; 3, 4, 5, 7, 8 and 9 have shape 0
  only. Every land and base terrain of `RANDOM_MAPS` is in the first set
  (test), and the land module runs before elevation (all tiles flat), so the
  guard passes for every land call. It can only fail for a flat-only terrain
  with objects on a sloped tile: shallows (4, object 80). Elevation keeps the
  spacing square of each level-1 tile all grass, so a shallows tile is sloped
  only if `clean_elevation` moves a hill two tiles; **unverified** that this
  never happens. `RmmMap` still takes the guard as passing.
- `RGE_Tile` keeps terrain in 5 bits and height in 3 (bit-fields,
  `include/map.h:32`). Every write in these modules (`tile->terrain_type =`
  in land and shallows, the xor-mask in `set_terrain`) touches only the
  terrain bits, so keeping `terrain` and `height` apart, as `RmmMap` does, is
  byte-exact.

### 12.4 Land module (`packages/sim/src/rmm-land.ts`)

Ported: `generate`, `base_land_generate` (zone-indexed counter quirk, direct
terrain writes, costs `r·100/32767 − count·clumpiness + 250`, neighbours left,
right, up, down, leftover fill), `check_terrain_and_zone`, `chance` (literal,
§5.2), and the controller's `calc_land_start` (`calcLandStart`) for the
§9.2/§9.3 vectors. Input: `LandInfo` (lands with walls and fade, base
terrain); the rest of the controller is not ported. Tests:
`rmm-land.test.ts`: §9.2 (map seed 41 → (62, 10), (34, 84), 9 draws), §9.3
(seed 101 → (85, 30), (10, 12), 15 draws), `chance` values, check counts,
the zone quirk, area spacing, walls, and a deterministic map from the §9.2
tables.

Checked: `chance` against the retail exe (above). Unverified: float rounding in
`calc_land_start` follows §4.1 (each step stored as float).

### 12.5 Shallows module (`packages/sim/src/rmm-shallows.ts`)

Ported: `generate` (pairs of land centres, then two random pairs of land
tiles, x then y draws over `W − 1`, retried on 1, 4, 22) and
`make_tribe_connections` (path costs as floats, own path list, walk back over
marks 4–11, a 4-draw box round water path tiles, water 4-neighbours of land
path tiles, every queued tile written as shallows). Tests:
`rmm-shallows.test.ts` (a strait is forded, draw counts on land, an
impassable target, retries on water).

### 12.6 Elevation module (`packages/sim/src/rmm-elevation.ts`)

Ported: `generate`, `generate_modifiers` (the terrain module's
`hotSpotModifiers`, same code), `link_stack_randomly` (the head is left empty
and only the drawn tiles reach it, unless tile (0, 0) is drawn, which relinks
the head to the rest of the chain), `check_start_elevation`,
`check_elevation`, `remove_area_from_lists` (row bound bug kept) and
`base_elevation_generate`. Input: `ElevationInfo` (levels, hot spots). Tests:
`rmm-elevation.test.ts` (§9.4 modifiers, `link_stack_randomly` with scripted
draws, a 48×48 run: heights ≤ 4, steps ≤ 1, shapes refreshed,
deterministic, a flat hot spot, water left alone).

Checked: `link_stack_randomly` (`0x470810`) and `check_start_elevation`
(`0x470480`) match the retail exe; `check_elevation` (`0x470560`) has the same
structure. Unverified: `check_elevation`'s details beyond that structure (N in
the decomp).

### 12.7 Cliffs module (`packages/sim/src/rmm-cliffs.ts`)

Ported: `generate`, `setup_cliff_maps`, `generate_cliff`,
`check_for_valid_cliff_site` (wrap by 3, `wrapCliffDirection`) and
`invalidate_cliff_area` (the bottom row is clamped only when the clamped
right column is past the last cell row; kept). Pieces come from `RmmMap`'s
TRIBE brushes. Input: `CliffsInfo` (the §4.5 numbers, hot spots). Tests:
`rmm-cliffs.test.ts` (direction wrap, pieces from the cliff table at cell
centres on cliff terrain, determinism, spacing from water and hot spots).
All cliff functions are M; nothing unverified beyond the shared operations.

### 12.8 Controller (`packages/sim/src/rmm-controller.ts`)

Ported: `TRIBE`/`RGE init` (`RmmController.init`: `add_land_module` with
`calc_land_start` and the team re-ordering, walls, zones and the shallows
decision; `add_terrain_module` with hot spots, clump scaling and the forest
variant; `add_object_module` with land points, nomad rows, the lake, islands
and the TRIBE exclusion zones; `add_elevation_module` with the random scale;
the cliffs decision), `generate` (land, shallows, elevation, cliffs, terrain,
objects with terrain objects; a logged draw before the first module and after
each; terrain 16 → 0) and `map_generate2` (`mapGenerate2`: `srand(seed)` twice,
init, `srand(seed)`, generate, one logged draw). Tests:
`rmm-controller.test.ts` (§9.2 tables and the 22 init draws, the §9.1 map
seed through the World, all nine map types on a Tiny map).

Checked against the decomp:

- The modules made in `init` (shallows, cliffs) copy their info then; the four
  made in `generate` copy theirs after all of `init`. So the shallows module
  sees the land centres before a lake shifts them, and the elevation hot spots
  (computed after the object module) index the shifted lands on a lake map.
- The object module's land points are built before the lake and islands; the
  islands add their own points (ids from the land count, player 0).
- AllLand (4) gets base terrain 0 only on the "no shallows" branch: a draw
  `< 0x3FFF` makes shallows and keeps the dat's base terrain.
- Floats: `terrain_size` keeps the x87 product (7371 for §9.4's 7372 × 100 %,
  §10), **unverified** against the retail exe. The elevation scale is checked
  there (`Empiresx.exe` 0x4740b7-0x4740ee): `fild rand; fmul -0.0018311106f;
  fsubr 70f; fmul 0.01f` (Hilly: `fmul 5f`) stays on the x87 stack and each
  size is `ftol(fild size × scale)`; the decomp's `float scale` is never
  stored. At the CRT's 53-bit precision control that is double math, as ported.
  §9.2's sizes (906, 724, 543, 361) come out either way.
- `place_cluster` can place nothing when its snapped start position overlaps an
  object (the land row's start test used the unsnapped one): a start may lack
  its near stone or gold pile while the far one is there (seed 79190, player 1,
  Large Mostly Land). Kept: it is the decomp's logic.

### 12.9 World option (`World({ randomMap })`, `packages/sim/src/world.ts`)

`randomMap: { type, size }` (default `DEFAULT_RANDOM_MAP`: Large 144, Mostly
Land, the multiplayer screen's defaults, `src/scr_mps.cpp:436-450`, with
positions fixed and the Default age) runs `new_game` for a random game from the
game seed: the players' `fog_update` draws (before the seed, the project's
decision, visibility.md §6), `srand(seed)`, draws after the seed, `new_map`,
Gaia and the players (`src/world.cpp:995-1009`), one before the map (`:1153`),
the map seed (`map_generate2` with seed −1, so the 6th draw: §9.1 holds),
the map on a `new_map` grid (terrain 0, height 1), two draws (`:1160`, `:1163`),
three rounds of every player's update with a zero delta (objects, conditions,
the AI fence), one draw (`:1182`), then the world's `random_seed` (`:1083`).
`random_start` draws nothing (every player has objects; its fallback Town
Center for an empty player is not ported). Then `TRIBE_World::new_game`:
relics and ruins (`placeRelicsAndRuins`, drawing after the seed was kept, so
they change the objects but not `random_seed`), the civ effects and the
new-game attributes. Objects are made through `World.createObject` (its draws:
setup, sprite, facing, unit AI). The special victories' wanted artifacts,
discoveries and ruins are 0 (those victories are not ported). The returned
`artifact_count` / `ruin_count` (5 or 0) go to the world's victory state for the
all-relics / all-ruins holds; the objects are Gaia's until a player's unit takes
them (victory.md §3, §10, §10.1; seeded counts per map type and size in
`relics.test.ts`). The lobby's start settings (Nomad's object rows, the
resource levels, ages, Full Tech Tree, Reveal Map) are lobby.md §2.1. Not
covered: alliances (none in a 2-player room), randomized positions.

The client builds every game this way (`apps/client/src/lockstep/lockstep.ts`),
with the map type and size the host picked in the lobby (`lobbyWorldOptions`,
lobby.md §6; the map types offered are those without water between the starts);
`?debug=net&map=test` keeps the fixed test map (`createTestMap`,
`startingObjects`) for the e2e that need fixed layouts. The camera starts on
the player's Town Center (`random_start`'s view). Tests:
`random-game.test.ts` (seeds, sameness, start ranges, a replay and its
snapshot), the `sampleRandomMapReplay` in the determinism e2e, and
`e2e/tests/random-map.spec.ts`.
