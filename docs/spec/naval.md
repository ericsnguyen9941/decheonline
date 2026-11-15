# Naval: zone maps, the Dock, fishing, war ships, boat repair

Source: aoe1-decomp @ `6d6d8b1` (July 1998 RoR beta; see `README.md` for the
version caveat and reference format). Numbers are the 1.0a `data2/empires.dat`'s
(`npm run dat:dump -- unit 45`). Float handling follows `core.md` §3. Movement
is `movement.md`, the unit AI `unit-ai.md`, combat and blast `combat.md`,
repair/heal/convert `support-actions.md`, tech effects `techs.md`.

Trade boats (15/16) are out of this document's port (ship S7); where their
rules sit next to the ones here they are named but not described. Transport
boats (17/18), boarding and unload are §7.

## 1. Functions

| function | ref | role |
| --- | --- | --- |
| `RGE_Zone_Map::do_zone_map`, `do_zone_map_area` | `src/zone_map.cpp:109`, `:163` | flood fill per passability pattern (§2.1) |
| `RGE_Zone_Map::withinRange` | `src/zone_map.cpp:239`, `:243` | a start-zone tile near a goal (§2.2) |
| `RGE_Zone_Map_List::get_zone_map` | `src/zone_map.cpp:429` | one map per terrain table |
| `RGE_Static_Object::lookupZone` | `src/stat_obj.cpp:2972`, `:2994` | the object's zone of a tile |
| `RGE_Moving_Object::canPath` | `src/move_obj.cpp:1415`, `:1468` | zone pre-check, then a tile path (§2.2) |
| `RGE_Moving_Object::firstTileAlongLine` | `src/move_obj.cpp:1866` | the repair rendezvous tile (§6.1) |
| `TRIBE_Combat_Object::useSameZoneDropsite` | `src/t_c_obj.cpp:685` | drop sites in the gatherer's zone (§2.2) |
| `RGE_Master_Static_Object::check_placement` | `src/m_s_obj.cpp:843` | the Dock's tile requirements (§3.1) |
| `TRIBE_Action_Make_Obj::place_obj` | `src/tact_mob.cpp:161` | where a trained boat appears (§3.2) |
| `TRIBE_Task_List::get_target_task` | `src/ttsk_lst.cpp:20-146` | fish to the Dock, boat repair tasks (§5.1, §6) |
| fishing ship unit AI | `src/taiuaimd.cpp:1510-1641` | reactions of a Fishing Boat (§5.2) |
| `TRIBE_Action_Repair::meet_target` | `src/tact_rep.cpp:354-391` | calling the boat to the shore (§6.1) |
| `TRIBE_Combat_Object::heal(float)` | `src/t_c_obj.cpp:982-999` | a boat's repair is paid (§6.2) |
| `RGE_Action_Enter` (action 3) | `src/act_entr.cpp` | a unit walks to a transport and boards it (§7.2) |
| `RGE_Static_Object::enter_obj`, `exit_obj`, `more_room` | `src/stat_obj.cpp:2068-2103`, `src/com_obj.cpp:413` | boarding, capacity (§7.3) |
| `RGE_Action_Transport` (action 12) | `src/act_tran.cpp` | the transport's default task, moving and dropping (§7.4) |
| `RGE_Static_Object::drop_held_objects`, `find_drop_location` | `src/stat_obj.cpp:2417-2534` | where the cargo lands (§7.5) |
| `RGE_Combat_Object::unload`, `TRIBE_Command::do_command_unload` | `src/com_obj.cpp:821`, `src/tcommand.cpp:513` | the Unload command (§7.6) |
| transport ship unit AI | `src/taiuaimd.cpp:1416-1480` | reactions of a transport (§7.7) |

## 2. Zone maps

### 2.1 Building a map

A zone map labels every tile with the connected region a unit of one
passability pattern can reach. The pattern is the unit's terrain table
(`terrain_restriction`, `TERRAIN_ROWS` in `unit-data.ts`): a terrain is
passable when its value is > 0. Every unit with the same pattern shares one
map (`RGE_Zone_Map_List::get_zone_map` compares the tables; the sim keys its
cache on the 32 passable flags). Land units of row 7 (grass, beach, shallows,
desert, forest, ...) share one map; boats (row 3: water 1, shallows 4, deep
water 22) another, so shallows join both. A unit's zones are its own row's:
the Dock (row 6: water, beach, shallows, deep water at 0.2) has its own.

`do_zone_map` clears the map to 255, then scans rows `y` then columns `x`; each
tile still 255 starts a new zone, flood-filled 4-connected over tiles of the
same passability (the seed tile's terrain is masked with `& 0x1f`). Zone
numbers count up from 0 and wrap at 255 → 0 (a byte); an impassable region is
a zone too. Maps are built on first use and never change in a game (terrain
does not change once the game has started).

### 2.2 Uses

- **`canPath(target, range)`** (`src/move_obj.cpp:1468-1508`), the unit AI's
  "can I reach it" (`unit-ai.md`: idle target search, retaliation, the
  builder's next foundation, the task searches): when the target's tile is in
  another zone of the unit's map *and* `withinRange(start tile, target tile,
  range)` fails, the answer is no without a path search. Otherwise a tile
  path search decides.
- **`withinRange(start, goal, r)`** (`src/zone_map.cpp:243-276`): the box of
  tiles `goal ± trunc(r)` clamped to the map; a tile counts when it is in the
  start tile's zone and `sqrtf(dx² + dy²) ≤ r` from the goal tile. A Bowman
  (range 5) on the beach can shoot a boat 4 tiles out; a Clubman (range 0)
  cannot reach it, so it neither searches a path nor chases (the arrows it
  takes make it run, `unit-ai.md`).
- **`lookupZone`** returns 0 for a tile off the map's negative side.
- **Drop sites.** A gatherer's drop-off search (`find_by_master_ids` with a
  zone object) only takes drop sites in its own zone when
  `useSameZoneDropsite()` is 1: every gatherer but a Fishing Boat (group 21)
  or trade boat (group 2). A Villager on an island with no Storage Pit or Town
  Center there fills up and waits holding its load (work state 2, no target).
- **The 3-tile arrival allowance.** A move of user waypoints whose first two
  points share a zone and whose distance to the goal is over
  `g_move_waypoint_distance_threshold` (4.0) arrives within 3 tiles
  (`src/move_obj.cpp:763-770`, `movement.md` §10).

## 3. The Dock

The Dock is unit 45 (Dock_1; Bronze Age, tech 102, copies 133 Dock_2 into it):
radius 1.5, 100 wood, terrain table row 6, `elevation` flag 0. Tech 90
(Stone Age, req 105) enables it; when one is built its completion tech 0
finishes, which with the Tool Age (101) makes tech 3 (no research time)
enable the Scout Ship 19.

### 3.1 Placement

`check_placement` (`src/m_s_obj.cpp:880-956`) on top of the land checks
(`economy.md` §4.6):

1. **Centre tile.** With a centre requirement (`center_tile_req1/2`, the
   dat's placement terrain; the Dock's `[1, 4]`, water or shallows) the
   centre tile of the footprint must be one of them, and the terrain-table
   ring check over the footprint shrinks to that tile.
2. **Side tile.** With a side requirement (`tile_req1/2`, placement side
   terrain; the Dock's `[2, -1]`, beach) one tile of the ring just outside the
   centre tile must match. The ring is walked top row, right column, bottom
   row (reversed), left column, corners left out; sides off the map are
   skipped.
3. Failure of either returns 1 (the same code as a blocked tile).

So a Dock stands with its centre tile in the water and a beach tile beside
it; open water, a centre on the beach or on land, or a beach elsewhere in the
footprint fails. The slope check (return 3) does not apply: the Dock's
`elevation` flag is 0.

### 3.2 Training: where a boat appears

`TRIBE_Action_Make_Obj::place_obj` (`src/tact_mob.cpp:161`) is the generic
spawn search (`economy.md` §6) run with the *trained unit's* terrain table:
the ring of tiles around the building, then wider, until a tile the unit may
stand on is free. A boat therefore appears on a water tile next to the Dock,
a Villager on land; nothing is boat-specific.

### 3.3 Boats and techs (1.0a dat)

| id | name | hp | speed | range | missile | cost | trained after |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 13 | Fishing Boat | 45 | 1.4 | — | — | 50 wood | Dock |
| 14 | Fishing Ship | 75 | 2 | — | — | 50 wood | tech 4 copies 14 into 13 |
| 19 | Scout Ship | 120 | 1.75 | 5 | 9 arrow | 135 wood | tech 3 |
| 20 | War Galley | 160 | | 6 | 9 | | tech 5 copies 20 into 19 |
| 21 | Trireme | 200 | | 7 | 204 bolt | | tech 7 copies 21 into 19 |
| 250 | Catapult Trireme | 120 | 1.35 | 9 | 368 stone, blast 1, level 2 | 135 wood, 75 gold | tech 9 enables |
| 277 | Juggernaught | | | 10 | 368, blast 1.5, level 1 | | tech 25 copies 277 into 250 |
| 360 | Fire Galley | | | 1 (melee) | none | 115 wood, 40 gold | tech 118 enables |

Techs (requirements; all at the Dock):

- 4 Fishing Ship (0, 102);
- 5 War Galley (0, 102);
- 6 Merchant Ship (copies 15 into 16, trade);
- 7 Trireme (5, 103);
- 8 Heavy Transport (copies 17 into 18, transport);
- 9 Catapult Trireme (7, 103);
- 25 Juggernaught (effect 121; 9, 35 Engineering, 103);
- 118 Fire Galley (0, 103, 5; no research time, so it completes the moment its
  requirements do).

Each Dock tech also adds 1 to attribute 21 (the tech count). A civ's tech
tree disables what it lacks (Egyptian has no Fire Galley; Carthage has it but
no Catapult Trireme). Ballistics (106) sets the stone 368's targeting to 1;
Alchemy and Engineering touch 250/277/360.

Civ ship bonuses are ordinary effect rows of each civ's tech-tree effect,
applied at game start (`techs.md`):

- Greek: war boat speed +0.3;
- Hittite: Scout Ship / War Galley range and sight +4;
- Minoan: boat cost ×0.7;
- Persian: Trireme reload 1.3;
- Phoenician: Catapult Trireme / Juggernaught reload 2.9;
- Yamato: boat hp ×1.3 / ×1.33;
- Macedonian: armour;
- Carthage: Fire Galley attack +6;
- Roman: Dock cost ×0.85.

## 4. War ships fight

A war ship (group 22) is an ordinary combat unit with the Soldier unit AI
(`unit-ai.md`): it searches targets in sight, retaliates, and follows the
attack action of `combat.md`. Scout Ship / War Galley shoot arrows (9), the
Trireme bolts (204); the Catapult Trireme and the Juggernaught throw stone
368 whose blast is the area attack of `combat.md` §4.4 (`blast_width`,
`blast_level` of the launcher). The Soldier AI's idle search skips the
STAND_GROUND catapults 35, 36 and 250, as for land catapults. The Fire Galley
has no missile: it closes to range 1 and hits in melee. Ships reach land
targets only within their range of the water: canPath's `withinRange` (§2.2)
is what tells them the shore unit is reachable.

## 5. Fishing

### 5.1 Gathering and the Dock

The Fishing Boat's task is gather (action 5) on object group 5 (fish), from
resource 17 into resource 0 (food): capacity 15, work rate 0.4, drop sites
`[45, -1]`. Fish-Salmon 53 (group 5) holds 250 food; the shore fish 260 and
263 and the whale 370 are the other fish. Gathering, delivery and returning to
the same kind of resource are the generic gather action (`economy.md`): the
boat takes 15 food, sails to the nearest own Dock (in any zone, §2.2), adds it
to the stockpile and goes back.

The task list's first pass (`src/ttsk_lst.cpp:44-46`): a Fishing Boat holding
trade goods (attribute 9) or fish (17), right-clicked on an own Dock 45, gets
the gather task that takes what it holds, i.e. it delivers there.

### 5.2 Fishing ship unit AI

`src/taiuaimd.cpp:1510-1641`. Important object groups (what it notices):
`[3, 22, 20, 2, 21, 5, 31, 33]`. On `ATTACKED`:

1. if it died: notify the player (0x209) and stop;
2. otherwise alert and ask for help, record the attacker, set "under attack";
3. a human player's boat with an order (≠ -1) keeps on (e.g. fishing);
4. else, if its action is not a move, re-queue its order and stop the object;
5. then run away from its attackers.

`processIdle` does nothing for a human player; `REQUEST_TASK` goes to the
base, which does nothing, so an idle human Fishing Boat is not sent back to
fish. Trade and transport boats have their own modules (S6, S7).

## 6. Boat repair

### 6.1 The repair task and the rendezvous

`get_target_task` (`src/ttsk_lst.cpp:95-107`): a target that is the unit's
own or a mutual ally's, of a boat group (2, 20, 21, 22), below its full hp and
not dying, takes the unit's first repair task whose object group is the
boat's (the Repair_Man 156 has one per boat class, work value 5). The
generic group pass after it (`RGE_Task_List::get_target_task`) also matches
those tasks, so a Villager right-clicked on a full own boat still becomes a
repairer; it adds nothing.

`meet_target` (`src/tact_rep.cpp:354-391`), run when the repair starts and
when it resumes work:

- when another of the owner's Repair_Men has this boat as its top action's
  target (in any state but 2), take that rendezvous: the boat's action target
  point when the boat's top action is in state 11, else the boat's position;
- otherwise `firstTileAlongLine(repairer tile, boat tile, beach, beach,
  passable)` steps from the repairer's tile towards the boat's in half-tile
  steps (twice the larger of |dx|, |dy|, float32) and takes the first beach
  tile (terrain 2) the repairer may stand on. The boat is ordered
  `moveTo(tile + 0.5, 0, unconditional)` there and its `command_flag` is
  remembered.

When the repairer is out of reach (state 10 entry) and the boat's
`command_flag` has not changed since, the boat is ordered to move to the
repairer. A boat given a new order by its player in between (the flag is a
byte counted up by `do_command`, by a work order, and by a move the current
action did not take) is not called back.

### 6.2 Paying for it

`TRIBE_Combat_Object::heal(float)` (`src/t_c_obj.cpp:982-999`): for a boat,
`healing = amount × hp / build_pts_required` (its train time), clamped to the
missing hp; the owner pays `pay_obj_cost(boat, healing / (hp × 2), ignore
pop)`, half the boat's cost for a full bar; when it cannot pay, nothing is
healed. Buildings follow `support-actions.md` §6.

### 6.3 Priests and boats

`support-actions.md` §4.4: a boat target doubles the conversion roll (×2, as
a priest). §5: a priest never heals a boat (groups 2, 20, 21, 22 are in the
heal filter).

## 7. Transport

### 7.1 The boats

Transport Boat 17 (Dock, 1.0a dat: hp 150, speed 1.4, 150 wood) and Transport
Ship 18 (hp 200, speed 1.75; tech 8 Heavy Transport copies 18 into 17). A transport is a unit whose
`unit_level` (dat `interfaceKind`) is 7; its capacity is `obj_max` (dat
`garrisonCapacity`): 5 for 17, 10 for 18. Its task list holds task 0, action
12 Transport, `isDefault` 1, terrain 2 (beach), and a search task (109). Its
group is 20 and its unit AI the transport ship's (§7.7). No 1.0a tech changes
`obj_max` (modify code 2).

### 7.2 Boarding: the Enter action (3)

Every land unit's task list has a task of action 3 (work range 1). The
task-list pass that picks it (`TRIBE_Task_List::get_target_task`,
`src/ttsk_lst.cpp:71-79`) runs after the own-foundation build pass and before
the repair passes: a target of the unit's owner or of a mutual ally, below
Dying, whose `unit_level` is 7, takes the unit's first Enter task, or no task
at all (the search ends either way). So a right click on an own transport,
damaged or not, boards it; a unit without an Enter task just walks there.

Creating the action aims it at the boat's position, then:

- when the boat's top action is in state 2 (idle) and has room (a human
  player's unit), or is in state 11 with `target2ID` 0 (moving after a move
  order): step from the unit's tile towards the boat's tile
  (`firstTileAlongLine`, §6.1) for the first beach tile (terrain 2) the unit
  may stand on. With one, the unit aims at its centre and the boat is ordered
  `moveTo(tile x, tile y, 0.5, unconditional)` (the integer corner, not the
  centre). Without one, the unit aims at the boat's position and the boat is
  ordered to the unit's position (range 0.5);
- otherwise, when the boat's top action is in state 11, the unit aims at that
  action's target point; else at the boat's position.

States (first in stack: 4):

- **4** walk (`Move_To` sub-action to the aim point, the task's work range).
  When the walk completes or is removed: if `distance_to_object(boat) - 1 >
  work range`, go to state 2; else board (§7.3). A failed walk goes to state
  2; an invalid target ends in state 13.
- **2** wait 1 s, then if still out of reach: when the boat is idle (state 2),
  re-aim along the line as above, but when the new tile equals the current
  aim, aim at the boat's position instead and walk (state 4) without a boat
  order; else order the boat to that tile with range 0 (or to the unit's
  position, range 0.5, when no tile is found). When the boat is moving (state
  11), aim at its target point. Then walk (state 4). In reach: board.
- After boarding (whether or not there was room), the unit AI is told
  ACTION_COMPLETED for action 0x269 (unless the action is a sub-action), and
  the action goes to state 1 and returns completed. In state 1 its next update
  removes it; that update only comes once the unit is outside again.
- **13** tells the unit AI ACTION_FAILED and fails.
- Every update first checks the target: missing, Dying or later, or no longer
  of a player the unit's owner calls an ally → TARGET_INVALID, state 1.

### 7.3 Inside a transport

`enter_obj` does nothing unless the boat has room (`objects < obj_max`).
Otherwise the unit leaves its tile (its line of sight is unexplored from
there), leaves the obstruction map, goes to the head of the boat's object list
and takes the boat's x/y. Its visible-unit records are forgotten
(`com_obj.cpp:413`).

While inside:

- its actions are not updated (only targets pending removal are cleared); the
  unit AI still runs;
- its static update skips the hit-point and death logic and copies the boat's
  object state whenever the boat's is past Active (`src/stat_obj.cpp:1233`):
  the cargo dies with its ship, with no dying sprite, death sound draw or
  corpse;
- an attack treats a target that is inside as invalid (`src/act_atak.cpp:292`).

A boat removed from the game exits every passenger (its destructor); a
passenger that copied ReadyToRemove is then removed by its next update.

### 7.4 The Transport action (12)

An idle transport always holds a Transport action (its default task, started
when it has no action). First in stack: state 11 when the action was made with
a point (x, y ≥ 0), else state 2. Every state change drops the sub-action.

- **2** idle: the standing sprite.
- **11** move (`Move_To` the target point, range 0.3, the task's move sprite);
  when it ends in any way, state 2.
- **4** move (as 11); when it ends, state 6.
- **6** drop: when the target point's zone (the boat's zone map) is not within
  2 tiles of the boat's tile (`withinRangeOfZone`, §2.2), the owner is told
  0x207 ("not close enough"). Otherwise, with passengers, if the boat is next
  to drop-off terrain, `drop_held_objects(target zone)`: none dropped → 0x207;
  some left aboard → 0x206 ("not enough room"). Not next to drop-off terrain:
  0x207 unless the target tile is water (1) or deep water (22). Then state 2.
- `move_to(x, y)` (a move order, or a unit calling the boat): target the point,
  `target2ID` 0, state 11. `stop`: state 2.
- `work(obj, x, y)`: `target2ID` 1. When the point's zone is within 2 tiles of
  the boat and the point is at most 2 from the boat: target it, state 6 (drop
  now). Else, for a point on the map: target it, state 4 when `obj` is the boat
  itself (unload), else state 11 (move only).

`next_to_drop_off_terrain`: true when the task's terrain is -1. Otherwise the
tile box `(int)(x - radius - 1) .. (int)(x + radius + 1)` (each axis, the
boat's radius, clamped to the map) must hold a tile of beach (2) or shallows
(4) in the target point's zone (any zone when there is no target point).

A targetless work order (a right click on the map) picks a task by the clicked
tile's terrain (`RGE_Task_List::get_target_task`'s terrain pass,
`src/task_lst.cpp:147-160`): a beach tile gives the transport task 0, so the
boat's Transport action takes `work(none, x, y)`: drop now when the beach is
within 2, else move there.

### 7.5 Where the cargo lands

`drop_held_objects(zone)` walks the passengers from the head of the list (the
last to board first). It keeps up to 9 drop points, starting with the boat's
position and twice the boat's radius; each passenger tries
`find_drop_location` around drop point 0 only. A success places the passenger
at the boat's position, exits it and teleports it to the spot, and appends the
spot (with twice the passenger's radius) to the drop points. A failure drops
the last drop point (the last one is copied over the one before it) and tries
again; with no drop points left, the rest stay aboard. Returns the count
dropped.

`find_drop_location`: the ring radius is the given radius plus the
passenger's; two rings (the second adds twice the passenger's radius), 50
tries each. A try draws `rand() * 4 / 0x7fff` for the side (0 east `x + r`, 1
west `x - r`, 2 south `y + r`, 3 north `y - r`; 4, when `rand()` is 32767,
keeps the last spot) and one more `rand()` for the position along it,
`value × 2r × (1/32767) - r` (float32). The spot must be on the map, in the
drop zone (when it is not -1), pass the passenger's `check_placement` (as a
unit is placed, other units ignored) and be passable for it.

So the Unload command (§7.6), whose target is the boat's own position and
zone, only drops onto shallows beside the boat (the land zone is not the
water zone); a drop onto a beach takes a targetless work order on a beach tile
within 2 tiles of the boat (verified against the 1.0a `Empiresx.exe`, not a
beta difference).

### 7.6 The Unload command

`do_command_unload` gives each listed object a player AI order UNLOAD (0x2D1)
at the command's point, range 1, immediate, priority 100. The unit AI runs
`unload(unconditional, x, y)`: `RGE_Combat_Object::unload` gives a top
Transport action `work(boat, boat's own position)` and ignores the point;
without one it replaces every action with a new Transport action that takes
`work(boat, x, y)`. On success the unit AI's action is 0x26D. The interface
sends it for the selected units of `unit_level` 7. The port ignores objects of
another player.

### 7.7 Transport ship unit AI

When hit (`ATTACKED`): a killing hit tells the owner 0x209 and clears the
notes. Otherwise the alert on the first attacker, a help call for a new one,
the attacker recorded (as the fishing ship, §5.2). With an order it keeps it
(returns 2). With no action, or a top action in state 2, it runs from its
attackers; returns 3. Every other note takes the base path.

## 8. Port status

Ported (`packages/sim`): zone maps (`zone-map.ts`, shared with the random map
generator's `rmm-map.ts`), `canPath`'s zone pre-check (`unit-ai.ts`), the
drop-site zone filter (`gather.ts`), the 3-tile arrival allowance
(`movement.ts`), the Dock's tile requirements (`buildings.ts`
`checkPlacement`), every boat and Dock tech of §3.3, fishing and the
Fishing Boat's task pass, the fishing ship AI (`unit-ai.ts`
`fishingShipNotify`), boat repair and its payment (`repair.ts`), the
`command_flag` (`world.ts` `countCommand`). Tests `naval.test.ts`; replay
`sampleNavalReplay` (in the determinism e2e).

Not ported: the slope check (placement return 3, no Dock needs it), transport
and trade boats and their AI, water maps in the lobby, computer-player
branches.
