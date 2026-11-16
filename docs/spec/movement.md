# Movement and pathing

Source: aoe1-decomp @ `6d6d8b1` (July 1998 RoR beta; see `README.md` for the
version caveat and reference format). Status letters: M matching,
D accepted_drift, L accepted_logic, N nonmatching. Numeric types and the
float-store assumption follow `core.md` §3; the RNG is `core.md` §4.

The three functions that do the real work, `PathingSystem::findTilePath`,
`PathingSystem::passable` and `RGE_Moving_Object::doMove`/`doTrivialMove`,
are all **L** (not byte-proven). Everything below that rests on them is the
decomp author's logic reading, to be confirmed by golden recordings.

## 1. Functions and status

| function | ref | status | role |
| --- | --- | --- | --- |
| `RGE_Action_Move_To` ctors | `src/act_move.cpp:21`, `:46` | M | move order; default range |
| `RGE_Action_Move_To::first_in_stack` | `src/act_move.cpp:85` | M | initial state |
| `RGE_Action_Move_To::update` | `src/act_move.cpp:120` | **D** | per-step state machine |
| `RGE_Moving_Object::findPath` | `src/move_obj.cpp:557` | M | first path search |
| `RGE_Moving_Object::doMove` | `src/move_obj.cpp:651` | **L** | per-step: arrival, waypoints, repath |
| `RGE_Moving_Object::doTrivialMove` | `src/move_obj.cpp:1069` | **L** | per-step: turn, step, collide |
| `RGE_Moving_Object::boundAngle` | `src/move_obj.cpp:2092` | M | wrap / snap angle to facet |
| `RGE_Moving_Object::set_angle` | `src/move_obj.cpp:406` | M | angle → sprite facet |
| `RGE_Moving_Object::setup` | `src/move_obj.cpp:137` | M | random initial facing |
| `RGE_Moving_Object::recycle_in_to_game` | `src/move_obj.cpp:80` | M | same, on reuse |
| `RGE_Moving_Object::maximumSpeed` | `src/move_obj.cpp:1927` | M | speed × sprite base speed |
| `RGE_Moving_Object::addUserDefinedWaypoint` / `removeUserDefinedWaypoint` | `src/move_obj.cpp:1953`, `:2011` | M / M | goal queue |
| `RGE_Moving_Object::canPath` | `src/move_obj.cpp:1415` | M | zone pre-check, then search without copying |
| `PathingSystem::PathingSystem` | `src/pathsys.cpp:30` | M | builds diagonal table |
| `PathingSystem::findTilePath` | `src/pathsys.cpp:210` | **L** | tile A* |
| `PathingSystem::copyPath` | `src/pathsys.cpp:1212` | **D** | search result → waypoints |
| `PathingSystem::passable` | `src/pathsys.cpp:1029` | **L** | footprint vs terrain + units |
| `PathingSystem::incrementObstruction` | `src/pathsys.cpp:164` | M | |
| `PathingSystem::decrementObstruction` | `src/pathsys.cpp:172` | **N** | |
| `PathingSystem::checksum` | `src/pathsys.cpp:1172` | M | XOR of obstruction bytes |
| `Path` (all 30) | `src/Path.cpp:6`–`:300` | M | waypoint list |
| `RGE_Zone_Map::do_zone_map` | `src/zone_map.cpp:109` | **D** | connectivity labels |
| `RGE_Zone_Map::do_zone_map_area`, `withinRange` | `src/zone_map.cpp:163`, `:243` | M | flood fill, range test |
| `RGE_Static_Object::addToObstructionMap` / `removeFromObstructionMap` | `src/stat_obj.cpp:2708`, `:2745` | M / M | footprint stamp |
| `RGE_Static_Object::teleport` | `src/stat_obj.cpp:1473` | **L** | position store, clamp, height |
| `RGE_Static_Object::get_terrain_speed` | `src/stat_obj.cpp:2043` | M | terrain multiplier |
| `RGE_Player::availablePathingAttempts` | `src/player.cpp:455` | M | per-step search cap |

Status source: `config/functions/src/{act_move,move_obj,pathsys,Path,zone_map,stat_obj,player}.cpp.json`
in the clone. All other functions in `Path.cpp`, `pathsys.cpp`,
`zone_map.cpp`, `move_obj.cpp`, `act_move.cpp` and `m_mo_obj.cpp` are M.

## 2. Inputs from `empires.dat`

| quantity | field | read at | used for |
| --- | --- | --- | --- |
| `radius_x`, `radius_y`, `radius_z` (float) | master static object | `src/m_s_obj.cpp:167-169` | footprint; `radius_z <= 0` means "never collides, straight-line path" |
| `terrain` (short) | master static object: terrain-restriction table index | `src/m_s_obj.cpp:186` | passability and speed table |
| `movement_type` (byte) | master static object | `src/m_s_obj.cpp:187` | 0 = z follows ground; 1 = z only rises (§8.6) |
| `speed` (float, tiles/s) | master animated object | `src/m_an_obj.cpp:39` | base speed |
| `turn_speed` (float, s per facet) | master moving object | `src/m_mo_obj.cpp:60` | turn timer (§8.3); 0 = turn instantly |
| sprite `facet_num` (short), `base_speed` (float), `flags` (byte) | sprite record | `src/sprite.cpp:83-84`, `:87` | facets for turning; speed multiplier when `base_speed > 0`; `flags & 2` = has facings |
| terrain restriction tables: `terrain_num`, `terrain_size`, then `terrain_num` float arrays | world header | `src/world.cpp:540-551` | `terrains[restriction][terrain]`: `> 0` passable; value is the speed multiplier |

The move sprite is the master's `move_sprite`, or `sprite` when that is null
(`src/act_move.cpp:35-41`). `maximumSpeed = speed × sprite.base_speed` when
the current sprite's `base_speed > 0`, else `speed` (`src/move_obj.cpp:1927-1932`).
Which sprite is current while walking (and so which `base_speed` applies) is
set by the action (`set_state(4)` → `new_sprite(move sprite)`,
`src/act_move.cpp:105-106`).

## 3. Constants

| name | value | ref |
| --- | --- | --- |
| default move range (range ≤ 0) | 0.4 tiles | `src/act_move.cpp:31-33` |
| full circle | 6.2831853 (double); wrap uses 6.2831855f | `src/game_globals.cpp:241-244` |
| π (double) | 3.14159265 | `src/game_globals.cpp:250-251` |
| 1/(2π) | 0.15915494f | `src/game_globals.cpp:252` |
| facet angle (8 facets / other) | 0.7853982f / 0.3926991f | `src/game_globals.cpp:256`, `:269` |
| snap tolerance | 0.1 rad | `src/game_globals.cpp:270` |
| turn threshold, normal / after repath | ±0.8 / ±0.9 facets | `src/game_globals.cpp:261-265` |
| collision wait base | 0.1 per `rand()%6` step, plus 0.5/speed | `src/game_globals.cpp:263`, `:254` |
| waypoint snap radius (overshoot / zig-zag) | 0.25 / 0.5 tiles | `src/game_globals.cpp:266`, `:253` |
| slope band | ±0.02 z per step | `src/game_globals.cpp:267-268` |
| slope multipliers (climb / descend) | 0.9 / 1.03 | `src/move_obj.cpp:1390`, `:1392` |
| range slack | 0.3 (stored as −0.3, subtracted) | `src/game_globals.cpp:260` |
| user-waypoint extra range | 3.0 when two waypoints share a zone and goal > 4 tiles | `src/move_obj.cpp:765-769`, `src/game_globals.cpp:259` |
| obstruction resolution | 4 cells per tile; 1020 × 1020 cells of 2 bits | `src/game_globals.cpp:279`, `src/pathsys.cpp:1172-1186` |
| path cost units | 16 per tile; straight step 16, diagonal step 22 | `src/game_globals.cpp:285`, `src/pathsys.cpp:606` |
| heuristic diagonal table | `D[i] = (int)(0.5 + i × 1.4142 × 16)`: 0, 23, 45, 68, 91, 113, … | `src/pathsys.cpp:59-64`, `src/game_globals.cpp:273-275` |
| search iteration budget `numberPathingIterations` | 2500 (Path Finding low), 5000 (medium), 7500 (high); −1 with `NOPATHLIMIT` | `src/game_globals.cpp:53`, `src/tribegam.cpp:2368-2378`, `src/basegame.cpp:1187-1188` |
| hard iteration ceiling | 20000 (0x4e20) | `src/pathsys.cpp:478` |
| path searches per player per step | 2 (`pathingCapValue`); −1 with `NOPATHCAP` | `src/game_globals.cpp:55`, `src/player.cpp:52-55`, `src/basegame.cpp:1231-1232` |
| wait steps before cap is ignored | 10 (`pathingDelayCapValue`) | `src/player.cpp:50`, `:455-458` |
| continue counter (repaths left) | user waypoints + 25 (human), + 15 (computer) | `src/move_obj.cpp:587-591` |
| max waypoints in a `Path` | 1001 (insert refused when size > 1000) | `src/Path.cpp:110-113` |

The player constructor's initializer list says cap 5, but the body
overwrites it with the global 2 (`src/player.cpp:50-55`, M).

## 4. Geometry and the obstruction map

- World coordinates are float tiles; tile `(tx, ty) = ((int)x, (int)y)`;
  the tile centre is `floor(x) + 0.5`. Code writes the centre as
  `floor(x) − (−0.5)` (`src/move_obj.cpp:630-631`).
- There are two global pathing systems: `pathSystem` (code 0, used by all
  unit movement) and `aiPathSystem` (code 1, computer-player planning)
  (`src/pathsys.cpp:27-28`). Only `aiPathSystem` ever has non-zero "misc"
  extra cost (`src/taiinfmd.cpp:1413`); for movement `misc` is 0.
- **Obstruction map**: per cell a 2-bit saturating counter (0..3), four
  cells per byte along y (`src/pathsys.cpp:160-178`; shifts 0/2/4/6,
  `src/game_globals.cpp:96-97`). A cell is blocked when its count is
  non-zero.
- **Stamp** (`addToObstructionMap`, `src/stat_obj.cpp:2708`, M): only if
  `radius_z > 0` and not already stamped. Cells
  `x ∈ [trunc(4(x−rx)), trunc(4(x+rx)))`, likewise y, minima clamped at 0;
  code 0 → `pathSystem`, 1 → `aiPathSystem`, 2 → both
  (`src/stat_obj.cpp:2717-2738`). `teleport` unstamps with code 2, moves,
  restamps with code 2 (`src/stat_obj.cpp:1481`, `:1537`).
- `teleport` clamps x to `[0, map_width − 0.001]` (same for y), moves the
  object between tile lists, and for `movement_type 0` sets `world_z` to the
  tile height plus a slope term from `tile_type` (17 cases), for type 1 only
  when that is higher (`src/stat_obj.cpp:1473-1632`, L). It returns that
  ground height `rz` (the missile's hit-ground test, combat.md §5). In
  float: `rx = x − (float)(int)x`, likewise `ry`, then the type's term (the
  table is in hud.md "Elevation") plus the tile's height. The dat has only
  `movement_type` 0 and 1 (`fly_mode`; 1 for the missiles, Smoke, Pigeons,
  lasers and the like). Port: `TileMap.groundZ` (f32 at every operation)
  and `tileType` in `packages/sim/src/map.ts`; `teleport` (movement.ts)
  sets `z` from it, so every placement and step on a hill carries the
  height. The client draws with the same function (hud.md "Elevation").

### 4.1 `passable(obj, x, y, checkTerrain)` (`src/pathsys.cpp:1029`, L)

1. Footprint in cells. With `fx = x − floor(x)`, the code computes
   `minX = 4·(int)x − (int)((fx + 100 − rx)·(−4)) − 400` and
   `maxX = 4·(int)x − (int)((rx + fx + 100)·(−4)) − 400`
   (`src/pathsys.cpp:1044-1051`). The ±100/±400 offsets make the truncation
   act as floor, so `minX = floor(4(x − rx))`, `maxX = floor(4(x + rx))`
   (inferred; exact up to float rounding). Then `minX += 1` if `minX < 0`
   (same for y) (`src/pathsys.cpp:1053-1058`).
2. If `checkTerrain`: tiles `minX>>2 .. maxX>>2` × `minY>>2 .. maxY>>2`
   (inclusive). Fail if `maxX>>2 ≥ map_width` or `maxY>>2 ≥ map_height`.
   A tile fails when `terrains[obj.terrain][terrain_type & 0x1f] ≤ 0`, the
   terrain is not one of the object's two terrain exceptions, and the tile's
   border (`border_type & 0x0f`) is 0 or its underlay terrain is also ≤ 0
   (`src/pathsys.cpp:1060-1097`). Note the inclusive `maxX>>2`: a footprint
   ending exactly on a tile edge also tests the next tile.
3. The object unstamps itself (`src/pathsys.cpp:1101`), then cells
   `[minX, maxX) × [minY, maxY)` (exclusive maxima) are tested; any non-zero
   cell fails. If `maxY − minY − 1 < 0` (footprint narrower than one cell)
   no cell is tested at all (`src/pathsys.cpp:1103-1104`). The fast mask
   path (`src/pathsys.cpp:1105-1129`) and the slow per-cell path
   (`src/pathsys.cpp:1130-1151`) give the same answer: in the slow path a
   hit inside the current target box sets a flag that also fails
   (`src/pathsys.cpp:1156-1158`).
4. Restamp the object (if it was stamped and is not inside another object)
   and return 1 / 0 (`src/pathsys.cpp:1160-1169`).

## 5. Move action: `RGE_Action_Move_To`

Created with a point or a target object, a range (≤ 0 → 0.4) and a sprite
(`src/act_move.cpp:21-73`). `first_in_stack`: if a target is already within
range → state 1 (done); if `maximumSpeed() == 0` → state 13 (failed);
else state 3 (`src/act_move.cpp:85-99`).

`update` (`src/act_move.cpp:120`, D), once per sim step for the unit's
current action:

1. Target id no longer exists, or target `object_state ≥ PENDING_REMOVAL`
   → target lost (`src/act_move.cpp:121-133`, `:231-236`).
2. **State 3 (need path)**: if target in range → state 1, return
   *completed* (`src/act_move.cpp:136-145`). Else copy the target's position
   into the goal; `setGoal(x, y, 1.0)`; if no final user waypoint yet, push
   the goal truncated to bytes as user waypoint and mark it final; set
   action range; set target id and target radii (or −1 / 0, 0)
   (`src/act_move.cpp:147-173`). Call `findPath`; `PathFound` → state 4,
   continue. Any other result stays in state 3 and retries next step
   (`src/act_move.cpp:175-179`).
3. **State 4 (moving)**: if the target has moved more than 1 tile on either
   axis from the stored goal, notify its own object `0x1FC` and re-run
   state 3 twice in the same step (`src/act_move.cpp:182-188`, `:223-228`;
   the label is `reached_target` but it means "target moved"; the port's
   `MoveContext.targetMoved`, the unit AI's reaction unit-ai.md §5.6). Else `doMove()`:
   0 → failed; 2 → completed (after the same moved-target check); 1 →
   continue (`src/act_move.cpp:191-210`).
4. A negative goal coordinate wraps to 255 when truncated to a byte (decomp
   note at `src/act_move.cpp:154-156`).
5. **Notifying the unit AI**: a top-level move (not a sub-action of work,
   attack, build or repair) that completes, fails or finds its target invalid
   notifies its own object, `notifyObject(ACTION_COMPLETED | ACTION_FAILED |
   TARGET_INVALID, ACTION_MOVE)` (`src/act_move.cpp:140`, `:205`, `:218`,
   `:236`). The unit AI sees order = action + 100 and calls `stopObject(1)`,
   which sets order and action to -1 (`src/aiuaimod.cpp:2974-2981`); the
   port does it in `objects.ts` right after `updateMover`. Without it a
   moved unit would keep order MOVE and ignore "attacked" notes (a moved
   Villager would not flee) and allies with an order would not answer a
   call for help.

### 5.1 Move command (`RGE_Command::do_command_move`, `src/Command.cpp:322`)

Runs after the one `rand()` every command draws (`core.md` §2.4). Objects are
looked up by id only; no owner check (`src/Command.cpp:60-65`).

- More than one unit listed: over the units that exist, track min/max of x
  and y starting from 10000 / 0 with an `else if` (a value only updates the
  max when it did not update the min, `src/Command.cpp:327-353`) and sum x, y
  in float. If either span exceeds 8.0 tiles, use the single-point order
  below. Else divide the sums by the listed count (missing ids included,
  `:358-359`) and send each unit to `(x − avgX) + order.x` (same for y); a
  result below 0 becomes 1.0, one at or past the map size becomes size − 1.0
  (`:378-394`). The layout of the group is kept around the clicked point.
- Otherwise every unit goes to the order point (`:421-442`).
- Each unit first gets a pathing group of all the *other* listed ids (in
  list order, `:366-376`, `:429-440`) and `waitingToMove = 1`.
- `move_to` (`src/act_obj.cpp:111`) offers the order to the current action
  first; without one it makes `RGE_Action_Move_To(range 0.4)` and makes it
  the only action. The old action's destructor clears the user waypoints and
  sets speed 0 (`src/act_move.cpp:75-78`); `first_in_stack` then picks state
  3 or 13 (§5).
- `removeAllUserDefinedWaypoints` does not reset `finalUserDefinedWaypoint`
  (`src/move_obj.cpp:2001-2009`); only `addUserDefinedWaypoint` does. So once
  a unit's first move has pushed its final waypoint, later plain moves skip
  §5 step 2's push and search straight to `int(goal)` with no user waypoint.

## 6. `findPath` (`src/move_obj.cpp:557`, M)

1. `radius_z ≤ 0` (non-colliding): path = [start, goal] without search,
   return `PathFound` (`src/move_obj.cpp:558-570`). Does not use the cap.
2. Pathing cap: if `availablePathingAttempts(numberWaitDelays)` is false,
   `numberWaitDelays += 1`, return `WaitingOnPathingCap`
   (`src/move_obj.cpp:580-583`). The player counter is zeroed at the start
   of each `RGE_Player::update` (`src/player.cpp:875`), so **each player may
   start 2 searches per step**, in object-update order; an object that has
   waited more than 10 times passes regardless (`src/player.cpp:455-462`).
3. Count the attempt, reset `numberWaitDelays`, set `continueCounter`
   (§3), start = current position, `closestDistanceToWaypoint = 100000`
   (`src/move_obj.cpp:584-593`).
4. `findTilePath(int(start), first user waypoint or int(goal), range,
   targetId, copy=1, checkIterations=1, checkTerrain=1, collisions=1,
   step=1, unobstructible=−1/−1)` (`src/move_obj.cpp:598-606`).
5. If not found and the path has exactly one waypoint, and the unit's tile
   centre is passable while the unit is not exactly on it: teleport to the
   tile centre and return `WaitingOnPathingCap` (retry next step)
   (`src/move_obj.cpp:628-641`).
6. Otherwise current waypoint = index 1 (index 0 is the start tile) and
   return `PathFound`, **even when the search failed** and returned a partial
   path (`src/move_obj.cpp:644-648`).

## 7. `findTilePath` (`src/pathsys.cpp:210`, L)

A tile-grid A* with integer costs in 1/16 tile.

### 7.1 Early exits

- Out of range: `start` or `goal` < 0 or > `xSizeValue` → kill path,
  return 0. Both axes are compared with the **x** size
  (`src/pathsys.cpp:286-293`).
- If `actionRange > 1`: `h = estimate(goal, start)`; if `h < range × 16`
  → empty path, return 1 (`src/pathsys.cpp:295-305`); else if
  `maximumSpeed() == 0` → return 0 (`src/pathsys.cpp:306-313`).

`estimate(a, b)` (`src/pathsys.cpp:181`): `dx = |ax−bx|`, `dy = |ay−by|`,
`D[min(dx,dy)] + 16 × (max − min)` (octile with the table in §3).

### 7.2 Setup

- Target box in cells: the goal tile `[4gx, 4gx+3] × [4gy, 4gy+3]`, or for
  a live target object `trunc(4(pos ± radius))` (`src/pathsys.cpp:345-358`).
- Unstamp the unit (`src/pathsys.cpp:364`). **Waypoint offset**: if the
  unit's own tile centre is passable, offsets = (0.5, 0.5), else the unit's
  current fraction in its tile (`src/pathsys.cpp:366-376`). All waypoints
  are `tile + offset`.
- Pathing group: when `continueCounter ≥ 10` and the unit has group
  members, members that are waiting, moving, or in a collision wait are
  unstamped for the search (`src/pathsys.cpp:380-394`) and restamped after.
- Facet generation counter: the per-tile "arrived from direction" byte
  stores `direction | generation`; generation goes 0, 8, …, 0xF0 then the
  array is reset to 0xFF (`src/pathsys.cpp:419-424`). A tile is "visited
  in this search" iff its high 5 bits equal the generation. The cost array
  is never cleared and is only read for visited tiles.
- Start node: cost `[start] = h(start)`, heap = {start}, heap slot 0 holds
  a −2·10⁹ sentinel, best-so-far = start (`src/pathsys.cpp:428-436`).
- Goal tolerance: `range × 16` when `range ≥ step` (1), else `16 × step`
  (`src/pathsys.cpp:438-441`). For a plain move (range 0.4) that is 16, so
  only the goal tile itself satisfies it.
- Sweep deltas: from the unit radius and the offset, integer tile and cell
  deltas so that the swept footprint between two tile positions can be
  tested (`src/pathsys.cpp:443-456`; same floor trick as §4.1).

### 7.3 Iteration cap (`src/pathsys.cpp:458-471`)

`dist = trunc(16·√(dx²+dy²)) / 16` (start→goal, integer division) — whole
tiles, truncated. `cap = dist × numberPathingIterations`, then `/ 10` if
`dist ≤ 10`, else `/ 100` (integer). Gaia (player 0) caps at 100. Computer
players instead use `dist × 2500 / 100`. The loop stops when
`iterations > cap` (only if the budget is not −1 and `checkIterations`) or
`iterations > 20000` (`src/pathsys.cpp:476-479`). Note the jump at 10 → 11
tiles (2500 → 275 iterations at the default budget).

### 7.4 Main loop

Per iteration, with `B` = heap top (`src/pathsys.cpp:473-943`):

1. `e = trunc(16·√((gx−Bx)² + (gy−By)²))`; track the closest `e`
   (`src/pathsys.cpp:487-492`).
2. **Goal test**: `e < tolerance` → copy path from `B`, return 1
   (`src/pathsys.cpp:494-525`). The test happens before `B` is popped.
3. If `e <` best-so-far total, best-so-far = (`B`, `e`)
   (`src/pathsys.cpp:527-531`). Best-so-far starts with the *octile*
   estimate of the start but is then compared with Euclidean `e`.
4. **Pop** (`src/pathsys.cpp:533-561`): move the last heap entry to slot 1,
   `n -= 1`, then sift down **only while `hole < n / 2`** (integer), picking
   the smaller child (right child on a strict `<`), stopping when the moved
   total is strictly less than the child. This is not a correct binary-heap
   pop: with `n ≤ 3` after the removal there is no sift at all, and deeper
   heaps stop one level early. Port it exactly.
5. **Expand** 8 neighbours in this order (offsets from `B`, step 1)
   (`src/pathsys.cpp:564-590`):
   0 (−1,−1), 1 (0,−1), 2 (+1,−1), 3 (+1,0), 4 (+1,+1), 5 (0,+1),
   6 (−1,+1), 7 (−1,0). Skip a neighbour when:
   - its direction bit is set in `FacetSkipMask[arrival direction of B]`
     (8 = start/unknown → mask 0). Masks `56, 112, 224, 193, 131, 7, 14, 28, 0`
     (`src/game_globals.cpp:667-669`): the reverse direction and its two
     neighbours are never tried (`src/pathsys.cpp:592-598`);
   - it is off the map, or it is the start tile (`src/pathsys.cpp:599-602`);
   - `newTotal = h(N) + step(B→N) + cost[B] − h(B)`, with
     `step = trunc(16·√(dx²+dy²))` = 16 or 22
     (`src/pathsys.cpp:604-610`); skip if `N` was visited in this search and
     `cost[N] ≤ newTotal` (`src/pathsys.cpp:612-618`). There is no closed
     set: a visited tile is re-pushed when the new total is lower, and stale
     heap duplicates are expanded again when popped.
6. **Terrain sweep**: tiles covered by the unit's footprint moving from `B`
   to `N` (a box spanning both positions, per direction,
   `src/pathsys.cpp:621-708`) must all pass the terrain rule of §4.1 step 2;
   the start tile is exempt (`src/pathsys.cpp:722-755`).
7. **Collision sweep** (when `checkCollisions`): the same swept box in
   cells against the obstruction map (`src/pathsys.cpp:757-817`). Non-zero
   cells fail, except that in the per-cell path (used when the box is ≥ 25
   cells tall or touches the target box) cells inside the target box mark
   "touching the target", which turns the step into an immediate success
   (`badCollision = 0`, `src/pathsys.cpp:812`).
8. Blocked neighbours are skipped unless an unobstructible group was given
   (never for movement: `findPath` passes −1) (`src/pathsys.cpp:819-857`).
9. Extra costs (`src/pathsys.cpp:859-876`): `+16 × misc` (0 for movement);
   `+16` / `+60` for passing an unobstructible unit with < 10 / ≥ 10 hp;
   **+1 when the direction differs from `B`'s arrival direction** (the start
   tile has none, so every first step pays +1). Touching the target sets the
   total to 0.
10. Store `cost[N]`, arrival direction, push onto the heap with sift-up on
    strict `<` (`src/pathsys.cpp:878-901`). If the step touched the target,
    copy path from the heap top (now `N`, total 0) and return 1
    (`src/pathsys.cpp:903-933`).

### 7.5 Exhaustion and path copy

- Heap empty or a cap hit: push best-so-far with total 0, copy the path from
  it and return **0** (`src/pathsys.cpp:953-1013`). So a failed search still
  leaves a path to the tile that came closest (by Euclidean `e`).
- `copyPath` (`src/pathsys.cpp:1212`, D) walks back from the heap top
  following stored arrival directions until it reaches the start tile,
  inserting at the front a waypoint `(tile + offset, z = unit z, facet)`
  each time the direction changes, and finally the start tile
  (`src/pathsys.cpp:1246-1336`). Result: `[start, turn points…, end tile]`.
  Insert fails beyond 1001 waypoints → path killed, search returns 0.

## 8. Per-step motion

### 8.1 `doMove` (`src/move_obj.cpp:651`, L)

1. `dX = max(0, |goal.x − x| − (targetRadiusX + radius_x))`, same for y;
   `dist = √(dX² + dY²)` (`src/move_obj.cpp:664-682`).
2. `range > 0` and `dist ≤ range` → stop, clear user waypoints, return 2
   (arrived) (`src/move_obj.cpp:683-689`).
3. `dist < 0.5`: if already exactly on the current waypoint → return 2;
   otherwise one `doTrivialMove` towards the goal itself and map its result
   (5, 2, 3, 4 → arrived; 0 → 1; 1, 6 → stop, 1)
   (`src/move_obj.cpp:691-729`).
4. `radiusDistance = √(rx² + ry²)`. If the unit is exactly on its current
   waypoint: teleport onto it if passable, advance to the next waypoint
   (`src/move_obj.cpp:732-757`). This is how waypoints are consumed (see
   §8.5 for the snap that makes the distance exactly 0).
5. **End of path** (no next waypoint, `src/move_obj.cpp:772-905`): arrived
   if `dist ≤ extra + radiusDistance + range` (extra = 3 only with ≥ 2 user
   waypoints in one zone and `dist > 4`). Else drop user waypoints from the
   front until one is farther than `radiusDistance + range + 0.3`; none left
   → return 0 (**the move fails**: with a single goal waypoint, a path cut
   short by the iteration cap ends the move here). Then
   `continueCounter −= 1` (exhausted → stop), check the pathing cap (blocked
   → stop this step, `numberWaitDelays += 1`), repath from the current
   position to the next user waypoint, with the same tile-centre teleport
   rule as §6 step 5.
6. Step towards the current waypoint with `doTrivialMove`
   (`src/move_obj.cpp:925`): 5 → arrived; 0 → continue; 1 → stop this step;
   2 (waypoint unreachable) → advance or, at the end, drop a user waypoint
   and repath as in step 5 (`src/move_obj.cpp:936-1056`); other → stop,
   return 0 or 1 (`src/move_obj.cpp:1060-1066`).

### 8.2 `doTrivialMove(x, y)` (`src/move_obj.cpp:1069`, L), in order

1. **Speed**: if `speed == 0` (not moving), `speed = maximumSpeed()` and
   aim from the tile centre instead of the exact position
   (`src/move_obj.cpp:1070-1078`, `:1107-1113`).
2. `d = world_time_delta_seconds × speed` (`src/move_obj.cpp:1080`).
3. **Collision wait**: if `collisionAvoidanceDistance > 0`, subtract `d`;
   still > 0 → `speed = 0`, return 0 (no move this step); else set it to −1
   (`src/move_obj.cpp:1082-1089`).
4. If `turn_speed > 0`: `turnTimer −= dt` when `turnTimer ≥ 0`, else
   `turnTimer = 0` (`src/move_obj.cpp:1091-1097`).
5. **Turn** (`src/move_obj.cpp:1099-1141`): `F = sprite.facet_num` (8 if no
   sprite). `a = atan2(dy, dx)` wrapped to `[0, 2π]`;
   `Δ = a − angle` wrapped to `[−π, π]`; `fΔ = Δ × F / (2π)`. Snap `angle`
   to the facet grid (`boundAngle`, §9). While `turnTimer ≤ 0` and
   `|fΔ| > 0.8`: `turnTimer += turn_speed`, rotate `angle` one facet
   (2π/F) towards the target, `fΔ ∓= 1`. Snap again, `set_angle`.
   With `turn_speed = 0` the loop turns all the way in one step.
6. **Step**: `vx = cos(angle)·d`, `vy = sin(angle)·d`; new position
   `(x+vx, y+vy)` (`src/move_obj.cpp:1143-1146`). The heading is always a
   facet direction: the unit walks along the nearest facet line, not
   straight at the waypoint, and only turns when off by more than 0.8 facet.
7. If `radius_z > 0`, `passable(new)` (`src/move_obj.cpp:1148-1151`).

### 8.3 Blocked step (`src/move_obj.cpp:1153-1346`)

- If `collisionAvoidanceDistance == 0` (fresh): draw
  `k = rand() % 6`; wait distance = `0.1k + 0.5/speed` (or `0.1k + 0.5` if
  speed is 0); `speed = 0`; return 0 (`src/move_obj.cpp:1154-1166`). The
  unit then waits in step 3 of §8.2 until its would-be travel covers that
  distance.
- Else (it already waited, value −1): set it to 0; snap to the tile centre
  if passable; if the target object is within
  `radiusDistance + range + 0.3` → return 5 (arrived); if the destination
  point itself is impassable → return 2; `continueCounter −= 1`, < 1 →
  return 4; pathing cap blocked → return 1; else repath, take the first
  waypoint, recompute the heading with the **±0.9** threshold (no turn at
  all this step if `turnTimer > 0`), and test the new step again
  (`src/move_obj.cpp:1168-1329`). Still blocked: computer player → 4; else
  draw a new wait exactly as above (`src/move_obj.cpp:1330-1345`).

### 8.4 Waypoint arrival (`src/move_obj.cpp:1348-1380`)

With a current waypoint: `cur` = distance to it now, `new` = distance after
the step. **Snap** onto the waypoint (teleport to it, or return 2 if it is
impassable) when either
`closestDistanceToWaypoint < new` and `cur < 0.25` (overshooting), or
the facet two steps ago equals the facet now, differs from last step's, and
`cur < 0.5` (zig-zagging between two facets). Otherwise teleport to the new
position. Without a waypoint: teleport to the new position.
Then `lastFacet2 = lastFacet`, `lastFacet = facet`,
`closestDistanceToWaypoint = cur` (`src/move_obj.cpp:1383-1387`).

### 8.5 Speed for the next step (`src/move_obj.cpp:1382-1404`)

`s = z_before − z_after`. If `s < −0.02` (climbing) multiplier 0.9; if
`s > 0.02` (descending) 1.03; otherwise `speed = maximumSpeed()` and
multiplier 1. Then multiplier ×= `terrains[restriction][tile terrain & 0x1f]`
and, if > 0, `speed ×= multiplier`. On slopes `speed` is **not** reset
first, so it compounds step by step (0.9ⁿ while climbing). The speed set
here is used for the *next* step's distance; the very first step of a move
uses `maximumSpeed()` without terrain. `z_before`/`z_after` are the unit's
`world_z` around this step's `teleport`, i.e. the ground's height (§4): on
the test map (flat) every step is level. The port's vectors are
`movement.test.ts` "climbing and descending speed" (up, down, level over a
one-level slope of type 8).

## 9. Angles and facets

- `boundAngle(a, F)` (`src/move_obj.cpp:2092`, M): wrap `a` into
  `[0, 2π]`; if `F ≠ −1`, snap to `i × step` for the `i ∈ 0..F` with the
  smallest `|a − i·step|` (strict `<`, scan stops early once the best is
  < 0.1), step = π/4 when `F = 8`, else π/8 regardless of `F`
  (`src/move_obj.cpp:2106-2138`). `i = F` (angle 2π) is possible.
- `set_angle` (`src/move_obj.cpp:406`, M): no facing sprite → facet 0. Else
  `t = (angle − π/4) × F / (2π) + 0.5`, `+F` if negative, facet `= (int)t`.
  So facet 0 is centred on angle π/4.
- Initial facing on create and on recycle: one `rand()`;
  `angle = (2π/F) × ((r × F) / 32767)` (integer division) when the sprite
  has facings and `F > 1` (`src/move_obj.cpp:150-169`, `:117-124`).
- `turn_towards` (`src/move_obj.cpp:368`, M), used by other actions to face a
  target: one facet per `turn_speed` seconds of world time, done when
  within ±0.5 facet.

## 10. Zone map (`src/zone_map.cpp`)

- One zone map per distinct passability pattern (sign of each terrain
  restriction value); `get_zone_map` returns an existing map whose pattern
  matches or builds a new one (`src/zone_map.cpp:214-232`, `:429-453`).
- `do_zone_map` (D): every tile starts at 255; scanning y then x, each
  unlabelled tile gets the next label (wrapping 255 → 0) and is flood-filled
  over 4-neighbours with the same passable/impassable class
  (`src/zone_map.cpp:123-160`, `:163-212`). The seed tile masks the terrain
  with `& 0x1f`; neighbours do not (`src/zone_map.cpp:142`, `:173`). Loops
  use width and height crosswise, so square maps are assumed.
- `withinRange(start, goal, r)`: true if some tile within Euclidean `r`
  (bounding box `±(int)r`) of the goal has the start's zone
  (`src/zone_map.cpp:243-276`). `canPath` returns 0 without searching when
  zones differ and this fails (`src/move_obj.cpp:1432-1447`).
- Movement itself (`findPath`, `doMove`) does not consult zones except for
  the 3-tile extra range (§8.1 step 5).
- Port: `packages/sim/src/zone-map.ts` (`ZoneMaps` on `PathingSystem`, built
  on first use per pattern, not hashed: they follow from the map), used by
  `canPath` (`unit-ai.ts`), the drop-site search (`gather.ts`) and the 3-tile
  extra range (`movement.ts`); the uses are naval.md §2.2.

## 11. RNG calls, in order

All draws go through `debug_rand` (`core.md` §4). In this subsystem:

| when | draws | ref (decomp line; original-source line in the call) |
| --- | --- | --- |
| moving object created (`setup`), sprite has facings, `F > 1` | 1: `(r × F) / 32767` → facing | `src/move_obj.cpp:153` (222) |
| moving object recycled into the game | 1, same formula | `src/move_obj.cpp:122` (197) |
| first blocked step (`collisionAvoidanceDistance == 0`) | 1: `r % 6` | `src/move_obj.cpp:1157` (1743) or `:1161` (1745) |
| blocked again right after a repath (human players) | 1: `r % 6` | `src/move_obj.cpp:1336` (2003) or `:1340` (2005) |
| move action enters state 4 / 1, 13, 14 and the sprite actually changes, new sprite animated with random start (flags 1 and 4) | 1: start frame (`sprites.md` §4) | `RGE_Action_Move_To::set_state`, `src/act_move.cpp:101-118`; `RGE_Moving_Object::new_sprite`, `src/move_obj.cpp:299-307` |

No direct draws in `Path.cpp`, `pathsys.cpp`, `zone_map.cpp`, `act_move.cpp`
or `m_mo_obj.cpp` (`grep -n debug_rand` finds none); the sprite swap above
draws inside the new active sprite. For the Villager the walk sprite (665,
sequence type 3) has no random start and the standing sprite (285, type 7)
has one, so a walk costs one draw when it ends (done or failed), none when
it starts. Per step, units draw in
object-update order (`core.md` §1.2 step 7.4); at most one draw per unit per
step from movement, since both draw sites return immediately.

## 12. Timing in sim steps

- Everything here runs inside the owning player's object update, once per
  world step with `world_time_delta > 0` (`core.md` §1.2). The object list
  prepends new objects (`RGE_Object_List::add_node`, `src/obj_list.cpp:57-70`)
  and `update` walks it from the head (`:226-247`), so a player's objects
  update **newest first**; that order decides who gets the 2 path searches
  and the order of RNG draws.
- Creating a moving object: the static setup shows the standing sprite (one
  draw if it has a random start, `sprites.md` §4), draws `r` and reseeds
  with it (`src/stat_obj.cpp:279-286`), then the facing draw of §9. A
  Villager takes three.
- Distance per step = `world_time_delta × 0.001 × speed`. At the default
  multiplayer step (`core.md` §2.2) and game speed the step length is fixed;
  at higher game speed `world_time_delta` grows, so each step moves farther
  (no sub-stepping).
- A unit that starts moving: step 1 of the order runs `findPath` in the
  action's state 3 and does **not** move; motion starts the next step
  (`src/act_move.cpp:175-178`).
- Searches: at most 2 per player per step (plus units past 10 waits);
  others wait a step with `speed = 0`.
- Collision wait: about `ceil((0.1k + 0.5/v) / (v·dt))` steps of no motion
  (each waiting step subtracts `v·dt` at the unit's full speed `v`; the
  step where it reaches ≤ 0 moves).
- Turning with `turn_speed > 0`: at most one facet per `turn_speed` seconds;
  while turning the step still moves along the current facet.

## 13. Worked examples (test vectors)

All float values are float32-rounded at each store (`core.md` §3
assumption, unverified for x87). Unit parameters are chosen inputs, not
`empires.dat` values; the port's tests should use them as given.

### 13.1 Example A — first straight step

Inputs: unit at (10.5, 10.5), `angle = 0`, `speed = 0` (idle), master
`speed = 1.2`, sprite `base_speed = 0`, `F = 8`, `turn_speed = 0`,
`radius_z > 0`, nothing blocking; current waypoint (14.5, 10.5);
`world_time_delta = 200` ms; flat ground, terrain multiplier 1.0.

1. `speed = 1.2000000477` (`src/move_obj.cpp:1071-1078`).
2. `dt = 0.2000000030`, `d = 0.2400000095` (`src/move_obj.cpp:1080`).
3. Aim from tile centre (10.5, 10.5): `dx = 4, dy = 0`, `a = 0`, `Δ = 0`,
   no turn; `angle` stays 0; facet: `t = −0.5 → +8 = 7.5` → **facet 7**
   (`src/move_obj.cpp:406-421`).
4. `vx = 0.2400000095`, `vy = 0`; new position **(10.7399998, 10.5)**.
5. `closestDistanceToWaypoint = 100000` is not `< new (3.76)`, `lastFacet2 =
   0xFF ≠ 7`: no snap; teleport to the new position
   (`src/move_obj.cpp:1364-1374`). After: `lastFacet = 7`, `lastFacet2 =
   0xFF`, `closestDistanceToWaypoint = 4.0`, `speed = 1.2 × 1.0`.
6. Footprint check of the new position with `radius = 0.2` (§4.1): at
   x = 10.5 cells `[41, 42)`; at x = 10.7399998 `minX = 40 − (int)(−402.16)
   − 400 = 42`, `maxX = 40 − (int)(−403.76) − 400 = 43` → cells `[42, 43)`,
   terrain tile 10 (`src/pathsys.cpp:1044-1051`).

### 13.2 Example B — facet-quantized heading

Inputs as A, but the waypoint is (11.5, 13.5) (`dx = 1, dy = 3`).

1. `a = atan2(3, 1) = 1.2490457`; `Δ = 1.2490457`;
   `fΔ = Δ × 8 × 0.15915494 = 1.5903343` (`src/move_obj.cpp:1116-1126`).
2. `|fΔ| > 0.8` and `turnTimer = 0 ≤ 0`: rotate +2π/8 → `angle =
   0.78539819`, `fΔ = 0.5903343`; `turnTimer += 0` keeps the loop open but
   `|fΔ| ≤ 0.8` ends it (`src/move_obj.cpp:1128-1138`).
3. `boundAngle(angle, 8)` keeps `π/4` (i = 1, difference 0); `set_angle`:
   `t = 0.5` → **facet 0**.
4. `vx = vy = 0.16970563`; new position **(10.6697054, 10.6697054)** — 45°,
   not the 71.6° bearing of the waypoint. The unit keeps this heading until
   the bearing differs by more than 0.8 facet (36°).

### 13.3 Example C — collision wait with the RNG

Inputs as A, but `passable(new)` fails, `collisionAvoidanceDistance = 0`,
and this is the first draw of the step with `random_seed = 14` (MS LCG,
`core.md` §4.1/§4.3).

1. Speed was 0 → `speed = 1.2`, `d = 0.24`. Blocked → `r = rand() = 84`,
   `k = 84 % 6 = 0`; wait distance `= 0 × 0.1 + 0.5 / 1.2000000477 =
   0.41666666` (`src/move_obj.cpp:1154-1166`). `speed = 0`, return 0; the
   unit does not move.
2. Next step: speed 0 → reset to 1.2, `d = 0.24`; `0.41666666 − 0.24 =
   0.17666665 > 0` → wait, no move, no draw (`src/move_obj.cpp:1082-1086`).
3. Next step: `0.17666665 − 0.24 = −0.06333336 ≤ 0` → value −1, the unit
   tries to move this step. If still blocked, it takes the repath branch
   (§8.3), not a new random wait.

### 13.4 Example D — search budget and heuristic numbers

Default budget 2500, human player, start (10, 10)
(`src/pathsys.cpp:458-471`):

| goal | `dist` | cap (iterations) |
| --- | --- | --- |
| (15, 10) | 5 | 5 × 2500 / 10 = **1250** |
| (20, 10) | 10 | **2500** |
| (21, 10) | 11 | 11 × 2500 / 100 = **275** |
| (30, 10) | 20 | **500** |

Gaia: min(cap, 100). Computer: `dist × 25`.
Heuristic `estimate((15,12), (10,10)) = D[2] + 16 × 3 = 45 + 48 = 93`
(`src/pathsys.cpp:181-207`); real step costs are 16 straight and
`trunc(22.627) = 22` diagonal, while the heuristic charges `D[1] = 23` per
diagonal: it slightly **overestimates** (not admissible).

### 13.5 Example E — the heap pop quirk

Heap totals by slot `[1..4] = 5, 9, 7, 8` (a valid heap). Pop: slot 1 ←
8, `n = 3`; `hole = 1 < 3/2 = 1` is false, so no sift
(`src/pathsys.cpp:533-561`). Heap is now `[8, 9, 7]` and the next
iteration expands the node with total **8**, not 7.

## 14. Implications for the port

- Implement `passable`, the obstruction counters (saturating at 3, including
  the 2-bit packing only if `checksum` is reproduced), the A* with its exact
  neighbour order, skip masks, +1 turn cost, broken pop, strict-`<` pushes,
  duplicate entries and iteration caps. Path shape depends on all of them.
- The facet generation counter can be any scheme with the same "visited in
  this search" meaning; the cost array need not be cleared.
- `atan2`, `cos`, `sin` and `sqrt` drive headings, steps and path costs;
  `packages/sim` must use deterministic replacements that reproduce the
  original float/double results (or at least agree across peers; golden
  agreement needs exact values). Path-cost `sqrt` only ever sees `dx²+dy²`
  of small integers and can be a table.
- The pathing cap and wait counters are game state; serialize them.
- `Path Finding` (budget 2500/5000/7500) is a room setting shared by both
  peers (lobby.md §2.2; world option `pathingIterations`).

## 15. Unverified or inferred

- All of §7, §4.1 and §8 rest on L functions; §5 on a D function.
- The floor reading of the ±100/±400 footprint formulas (§4.1, §7.2) is
  inferred from the arithmetic; float rounding at the edges is unverified.
- x87 precision for the `atan2`/`cos`/`sin` paths (§13 values assume float32
  stores and correctly rounded double math).
- Facet counts of AoE sprites (`facet_num`, assumed 8 for walking units in
  the examples) and real unit radii/speeds/turn speeds were not read from
  `empires.dat` for this spec.
- Whether the retail 1.0a pathing cap (2), budgets and constants match this
  beta (`beta-only?`).
- That a path truncated by the iteration cap makes a single-waypoint move
  fail at the path's end (§8.1 step 5) is a reading of `doMove` (L), not
  observed in play.
