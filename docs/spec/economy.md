# Economy: gather, drop-off, build, train

Source: aoe1-decomp @ `6d6d8b1` (July 1998 RoR beta; see `README.md` for the
version caveat and reference format). Status letters: M matching,
D accepted_drift, L accepted_logic, N nonmatching. Data values are read from
the retail RoR `data2/empires.dat` with `@aoe/data` (`parseDat`), civ 1
(Egyptian) unless stated; dat field names are those of
`packages/data/src/types.ts`.

Time: every rate below is multiplied by `world_time_delta_seconds`
(`dts`, float, `delta_ms * 0.001f`, `core.md` §1.2 step 7.3). There is no
fixed economy tick: each world step applies one increment of `rate × dts`.

## 1. Function status

| function | ref | status | notes |
| --- | --- | --- | --- |
| `RGE_Action_Gather::first_in_stack` | `src/act_gath.cpp:57` | M | |
| `RGE_Action_Gather::set_state` | `src/act_gath.cpp:93` | **L** | drop-site search lives here |
| `RGE_Action_Gather::update` | `src/act_gath.cpp:227` | **L** | INDEX.md listed it as M; the JSON says `accepted_logic` |
| `RGE_Action_Gather::move_to`, `work` | `src/act_gath.cpp:496`, `:526` | M | |
| `TRIBE_Action_Hunt::first_in_stack`, `set_state` | `src/tact_hnt.cpp:57`, `:95` | M | |
| `TRIBE_Action_Hunt::update` | `src/tact_hnt.cpp:248` | **L** | |
| `TRIBE_Action_Build::set_state` | `src/tact_bld.cpp:56` | M | |
| `TRIBE_Action_Build::update` | `src/tact_bld.cpp:136` | **D** | INDEX.md listed it as M |
| `TRIBE_Building_Object::setup` | `src/t_b_obj.cpp:144` | M | |
| `TRIBE_Building_Object::set_object_state` | `src/t_b_obj.cpp:229` | M | completion, RNG draw |
| `TRIBE_Building_Object::update` | `src/t_b_obj.cpp:334` | M | |
| `TRIBE_Building_Object::build` | `src/t_b_obj.cpp:700` | M | |
| `TRIBE_Building_Object::cancel_build` | `src/t_b_obj.cpp:672` | M | |
| `TRIBE_Building_Object::heal` | `src/t_b_obj.cpp:215` | M | repair cost |
| `TRIBE_Building_Object::add_to_production_queue` | `src/t_b_obj.cpp:800` | **D** | |
| `TRIBE_Building_Object::remove_from_production_queue` | `src/t_b_obj.cpp:862` | M | |
| `TRIBE_Building_Object::advance_production_queue` | `src/t_b_obj.cpp:922` | **N** | |
| `TRIBE_Building_Object::empty_production_queue` | `src/t_b_obj.cpp:939` | M | |
| `TRIBE_Building_Object::update_production_queue` | `src/t_b_obj.cpp:959` | M | |
| `TRIBE_Action_Make_Obj::first_in_stack` | `src/tact_mob.cpp:55` | **N** | |
| `TRIBE_Action_Make_Obj::update`, `place_obj`, `stop` | `src/tact_mob.cpp:102`, `:161`, `:225` | M | |
| `RGE_Action_Make::first_in_stack`, `set_state`, `update` | `src/act_make.cpp:20`, `:30`, `:35` | M | farm food production, §4.7; ported (`make.ts`) |
| `RGE_Action_Object::update` default task | `src/act_obj.cpp:403` | M | only the make task is started (§4.7) |
| `TRIBE_Player::check_obj_cost`, `pay_obj_cost`, `reimburse_obj_cost` | `src/tplayer.cpp:1031`, `:1080`, `:1101` | M | |
| `RGE_Player::add_attribute_num` / `TRIBE_Player::add_attribute_num` | `src/player.cpp:853` / `src/tplayer.cpp:3661` | M / M | |
| `RGE_Static_Object::set_attribute_amount` | `src/stat_obj.cpp:2210` | M | |
| `RGE_Static_Object::distance_to_object` | `src/stat_obj.cpp:2299` | M | |
| `RGE_Object_List::find_by_master_ids` | `src/obj_list.cpp:418` | M | nearest drop site |
| `RGE_Action_Object::work2` | `src/act_obj.cpp:147` | M | task choice, villager type swap |
| `TRIBE_Command::do_command`, `do_command_make`, `do_command_build`, `do_command_queue`, `do_command_cancel_build` | `src/tcommand.cpp:36`, `:104`, `:175`, `:530`, `:435` | M | |
| `TRIBE_Command::do_command_build_wall`, `place_line_of_walls` | `src/tcommand.cpp:239`, `:298` | M | wall line, §4.8.1 |
| `TRIBE_Building_Object::connect`, `connect2`, `check` | `src/t_b_obj.cpp:535`, `:565`, `:465` | M | wall joining, §4.8.2 |
| `TribeCivilianUnitAIModule::processNotify` (build request) | `src/taiuaimd.cpp:811` | **L** | builder's next foundation, §4.8.3 |

The three `L`/`D` bodies that carry the gather and build rates
(`act_gath.cpp` update, `tact_hnt.cpp` update, `tact_bld.cpp` update) were
not byte-proven; their arithmetic is the same shape in all three files, which
is weak corroboration only.

## 2. Data used (empires.dat)

### 2.1 Field map

| decomp field | dat field (`@aoe/data`) | used for |
| --- | --- | --- |
| `RGE_Master_Action_Object::work_rate` (`include/m_ac_obj.h:19`) | `action.workRate` | gather, build and train speed |
| `drop_site`, `backup_drop_site` (`include/m_ac_obj.h:20-21`) | `action.dropSites[0..1]` | where carried goods go |
| `RGE_Master_Static_Object::attribute_max_amount` (`include/m_s_obj.h:518`) | `resourceCapacity` | carry limit; also clamp on a resource object |
| `attribute_type_held[3]`, `attribute_amount_held[3]`, `attribute_flag[3]` | `resourceStorages[i].type/amount/flag` | starting load, owner effects (§6.3) |
| `build_inventory[3]` (`type`, `amount`, `flag`) | `creatable.costs[i]` | cost; flag 0 = checked but not paid |
| `build_pts_required` | `creatable.trainTime` | build points of a building, train time of a unit (s at rate 1) |
| `RGE_Task::attribute_type` | `task.resourceIn` | type carried while doing the task |
| `RGE_Task::attribute_type2` | `task.resourceMultiplier` | player attribute that multiplies the take |
| `RGE_Task::attribute_type3` | `task.resourceOut` | player attribute credited on drop-off (`-1`: the carried type) |
| `RGE_Task::work_val1` | `task.workValue1` | rate multiplier |
| `RGE_Task::work_range` | `task.workRange` | approach range |
| `RGE_Task::work_flag` | `task.gatherType` | farm: 0 = put food into the farm itself (sim `Task.workFlag`) |
| `RGE_Task::is_default` | `task.isDefault` | the master's `default_task` (sim `Task.isDefault`) |

The task field order is from `RGE_Task::load` (`src/task.cpp:71-93`, M).
The name `gatherType` for `work_flag` is the reader's; the position match is
the evidence (`src/task.cpp:93`).

### 2.2 Values (RoR `data2/empires.dat`, civ 1)

Villager types share one task-swap group (`taskSwapGroup` 1):

| id | name | workRate | cap | drop sites | task (action type, target, in → out, ×attr) |
| --- | --- | --- | --- | --- | --- |
| 83 | Man | 1 | 0 | 109, -1 | none (switches type on first work order, §3.1) |
| 118 | Builder | 1 | 10 | 109, -1 | 101 build |
| 119 | Fisherman | 0.6 | 10 | 103, 109 | 5 gather, class 5, 17 → 0, range 0.6 |
| 120 | Forager | 0.45 | 10 | 109, 68 | 5 gather, class 7, 16 → 0 |
| 122 | Hunter | 0.45 | 10 | 109, 103 | 110 hunt, classes 9 and 10, 15 → 0 |
| 123 | Lumberjack | 0.55 | 10 | 109, 103 | 110 hunt, class 15 (trees), 1 → carried |
| 124 | Miner-Stone | 0.45 | 10 | 109, 103 | 5 gather, unit 102, 2 → carried |
| 251 | Miner-Gold | 0.45 | 10 | 109, 103 | 5 gather, unit 66, 3 → carried, × attribute 47 |
| 259 | Farmer | 0.45 | 10 | 109, 68 | 5 gather, unit 50, 16 → 0 |

All `workValue1` = 1. Rates are float32 (`0.45` is stored as
0.449999988…). Drop-site ids: 109 Town Center, 103 Storage Pit, 68 Granary,
45 Dock.

| id | name | hp | trainTime | cost | storages (type, amount, flag) |
| --- | --- | --- | --- | --- | --- |
| 83 | Man (villager) | 25 | 20 | 50 food (flag 1), 1 of attr 4 (flag 0) | (4, -1, 2), (11, +1, 2), (19, +1, 1) |
| 109 | Town_Center1 | 600 | 60 | 200 wood, 1 of attr 30 (flag 0) | (4, +4, 4), (30, -1, 2) |
| 12 | Barracks1 | 350 | 30 | 125 wood, 1 of attr 30 | (30, -1, 2) |
| 70 | House | 75 | 20 | 30 wood, 1 of attr 30 | (4, +4, 4), (30, -1, 2), (51, +1, 1) |
| 50 | Farm | 50 | 30 | 75 wood, 1 of attr 30 | (0, 15, 0), (30, -1, 2); cap 15; workRate 0.4; task 21 make, in 16 |
| 68 / 103 | Granary / Storage_Pit1 | 350 | 30 | 120 wood | |

Gaia resources (civ 0): Mine-Gold 66 holds 400 (cap 400), Mine-Stone 102
holds 250, Forage-Fruit 59 holds 150, Gazelle 65 holds 150 (8 hp),
Elephant 48 holds 300 (45 hp), trees (class 15) 25 hp and 40 or 75 wood.
Collision radii used by §5.4: Town_Center1 1.5 × 1.5, villager 0.2 × 0.2.

Player attributes involved (`include/player.h:5-56`): 0 food, 1 wood,
2 stone, 3 gold, 4 population headroom, 11 population, 19 total units owned,
29 gold replacement, 32 population limit, 49 gold earned. Not named in the
header, meaning **inferred**: 36 = farm food (civ start value 250; used only
by `RGE_Action_Make`, §4.3), 47 = gold-mining multiplier (civ start value 1;
the gold miner's `resourceMultiplier`), 30 = a building allowance that each
building costs 1 of (flag 0) and holds −1 of while it exists
(`TRIBE_Player` load sets it to 0 at `src/tplayer.cpp:461`; how it becomes
≥ 1 in a game is **unverified**, likely a start tech effect).

## 3. Gathering

### 3.1 Choosing the action

A work order on an object calls `RGE_Action_Object::work2`
(`src/act_obj.cpp:147`, M). It asks the unit's own task list for a task
matching the target (`src/act_obj.cpp:159`). If none matches and the unit has
a task-swap group, it scans `master_objects` in ascending id order for a
master of the same object group, master type and swap group whose tasks
match, and **transforms** the unit into that master
(`src/act_obj.cpp:160-172`): first match wins. This is how a Man (83)
becomes Lumberjack (123), Miner-Gold (251), and so on.

When a gather or hunt action becomes active, if the unit holds a type other
than the task's `attribute_type`, its load is replaced by 0 of the task type
(`src/act_gath.cpp:60-62`, `src/tact_hnt.cpp:60-63`): **switching task
throws away the carried goods** with no credit.

### 3.2 State machine (`RGE_Action_Gather`, `src/act_gath.cpp`)

States (numbers as in the code): 1 done, 2 idle, 3 waiting for a task,
4 moving to target, 6 turning to target, 7 working, 8 returning goods,
11/15 moving to a point, 13 failed.

Checks at the start of every `update` (`src/act_gath.cpp:228-246`): a
target id that no longer resolves, or a target in state ≥
pending-removal, is dropped; a target owned by a player other than Gaia and
other than the gatherer's owner makes the action end (state 1, returns
target-invalid).

| state | per-step behaviour | ref |
| --- | --- | --- |
| 3 | timer starts at −10 s; adds `dts`; when it passes 0 it is reset to −10 and the unit AI is asked for a new task (no RNG) | `src/act_gath.cpp:98-104`, `:249-260` |
| 4 | walk sub-action to target within `work_range`; on arrival → 6; on fail → 3 (human) or 13 (computer player) | `:131-151`, `:293-314` |
| 6 | turn towards target; when facing: if target holds > 0 (or is a farm/dock, §3.4) → 7, else drop target → 3 | `:316-330` |
| 7 | transfer (§3.3) | `:332-383` |
| 8 | find drop site, walk there, deposit (§3.5) | `:169-213`, `:385-439` |

### 3.3 Transfer per step (state 7)

In order (`src/act_gath.cpp:347-381`, L):

1. `give = work_val1 × work_rate × dts` (product left to right, float).
   With the debug `quick_build` flag set, `give` is the whole target amount.
2. `give = min(give, target.held)`.
3. `m = 1` if `attribute_type2 == -1`, else `m = owner.attributes[attribute_type2]`.
4. `max_hold = cap × m` (cap = gatherer's `resourceCapacity` as float);
   `adj = m × give`.
5. If `adj > max_hold − unit.held`: `excess = adj − (max_hold − unit.held)`;
   `adj −= excess`; `give −= excess / m`.
6. `target.held = target.held − give`, then clamped to at most
   `(float)(int) target.cap` (`set_attribute_amount(-give, 1, 1)`,
   `src/stat_obj.cpp:2210-2222`).
7. `unit.held = unit.held + adj` with **no clamp** (`check_max` = 0).
8. Stay in 7 while `unit.held < max_hold` and (`target.held > 0` or the
   target is a farm or dock); otherwise → 8.

Notes:
- The take is not limited by anything else: a gatherer's yield per second is
  exactly `work_val1 × work_rate × m` until full.
- Because of step 5, the unit ends at exactly `max_hold` up to float
  rounding; if rounding leaves it just below, it keeps working one more step
  (step 8 compares with `<`).
- Step 6 clamps the **target** to its own cap. A resource object whose
  starting load exceeds its cap (Tree94, id 56: 75 wood, cap 40) loses the
  excess on the first take. Whether trees are gathered as the living object
  or as their dead object (`deadUnitId`) is decided by the hunt/death code
  (§3.6) — **unverified** which object holds the wood at that point.
- Thresholds `g_gather_positive_amount_threshold = 0.0f` and
  `g_gather_dropoff_distance_threshold = 1.0`
  (`src/game_globals.cpp:187-188`).

### 3.4 Farms and docks keep the worker

`keepGatheringWhenObjectIsOut` is true only for master ids 50 (Farm) and 45
(Dock_1) (`src/t_c_obj.cpp:665-671`, M). An empty farm therefore keeps its
farmer in state 7, taking 0 per step, until the farm has food again or is
gone. The farm makes its own food, §4.3.

### 3.5 Drop-off (state 8)

1. If carrying > 0 and no drop site is set: if the unit's `drop_site` is
   −1, there is none; else search the owner's object list with
   `find_by_master_ids(drop_site, backup_drop_site, unit.x, unit.y, …)` for
   objects in state **active** (`src/act_gath.cpp:170-189`).
   - Land gatherers pass themselves as the zone object, so only drop sites
     in the same connectivity zone count; fishing and trade boats (groups
     `OBJECT_GROUP_FISHING_BOAT`, `OBJECT_GROUP_TRADE_BOAT`) pass none
     (`useSameZoneDropsite`, `src/t_c_obj.cpp:685-690`).
   - Choice: smallest squared Euclidean distance between centres (float);
     ties keep the **earlier** object in the owner's list (strict `>`)
     (`src/obj_list.cpp:452-453`). Primary and backup ids are equal
     candidates.
2. No drop site: notify the AI and fail (state 13) (`:203-204`). Carrying
   0: drop a target that is empty (unless farm/dock) and go to 3
   (`:208-212`).
3. Walk to the drop site within `work_range`. When the walk ends, if
   `distance_to_object(drop) > 1.0` the unit stops and waits 3 s (timer −3),
   then searches again (`src/act_gath.cpp:386-412`). `distance_to_object`
   is the edge-to-edge distance: per axis `max(0, |dx| − r_a − r_b)`, then
   the Euclidean length (`src/stat_obj.cpp:2299-2320`).
4. Deposit (`src/act_gath.cpp:418-424`): attribute = `attribute_type3`, or
   the carried type if −1; `owner.attributes[attr] += unit.held` (float, no
   rounding to integers); if attr is gold (3) and this is the gather action,
   `attributes[49]` (gold earned) also increases
   (`src/tplayer.cpp:3661-3664`; the hunt action passes "not earned",
   `src/tact_hnt.cpp:458`). Then the unit holds nothing (type −1, 0).
5. Go back: to the target object if it still exists (state 4), else to the
   remembered point (state 11), else idle (`:426-435`).

**Implication for the port:** the drop-off distance test compares a square
root with 1.0; compare the squared length with 1.0 instead (same result,
no `sqrt` in `packages/sim`).

Ordering a gatherer onto its own drop site while it carries anything sends
it straight to state 8 with that building as the drop site
(`src/act_gath.cpp:72-80`, `:526-545`).

### 3.6 Hunting and wood (`TRIBE_Action_Hunt`, `src/tact_hnt.cpp`)

Hunter and Lumberjack use action type 110 (`TRIBE_ACTION_TYPE_HUNT`,
`include/action.h:23`), not gather. Differences from §3.2–3.5:

- Entering state 4 with a target whose object state is ≤ active (still
  alive) goes to state 12, which runs an attack sub-action with the task's
  work sprite and range (`src/tact_hnt.cpp:142-145`, `:157-170`). After the
  attack completes it re-enters 4 on the (now dead) target. Damage and death
  are the combat spec's.
- `produceWhenKilledBy` keeps the carcass food only when the killer is a
  civilian (group 4) (`src/t_c_obj.cpp:676-683`); so a hunted animal
  killed by a soldier or a lion has 0 food.
- The transfer is the same 8 steps as §3.3 (`src/tact_hnt.cpp:369-417`), but
  step 8 has **no** farm/dock exception, and thresholds are
  `g_hunt_empty_amount = 0.0f`, `g_hunt_drop_distance_threshold = 1.0`
  (`src/game_globals.cpp:338-339`).
- The drop-site search always uses the zone check (`src/tact_hnt.cpp:195-203`).
- Deposit is not "earned" (`src/tact_hnt.cpp:458`).
- `update` is **L**; set_state and first_in_stack are M.

## 4. Construction

### 4.1 Placing a foundation (`do_command_build`, `src/tcommand.cpp:175`, M)

1. `check_placement` on the master at the order's x, y (construction radius,
   objects that can be built on ignored; §4.6); non-zero means refused: tell
   the AI, stop (`:194-206`).
2. `pay_obj_cost(obj_id, 1.0, 0)` (§6.1); not affordable: stop (`:208-219`).
3. `make_new_obj` creates the building (`:221`). `TRIBE_Building_Object::setup`
   (`src/t_b_obj.cpp:144-163`) sets state **unbuilt**, `build_pts = 0`,
   `hp = 1.0`, the construction sprite, then `check_destructables` (§4.6)
   destroys what can be built on under the foundation.
4. Every listed unit gets `do_command(building)` (`:226-236`).

### 4.2 Building per step (`TRIBE_Action_Build`, `src/tact_bld.cpp`)

States as gather, without 8. In state 7 (`src/tact_bld.cpp:208-232`, D):

1. `work = work_val1 × work_rate × dts` (1000 with `quick_build`).
2. `TRIBE_Building_Object::build(work)` (`src/t_b_obj.cpp:700-717`, M):
   - only if state is unbuilt (else returns "done");
   - `work = min(work, required − build_pts)`, `required` =
     `(float)(int) trainTime`;
   - `hp = hp + max_hp × work / required` (product before division), clamp
     `hp ≤ max_hp`;
   - `build_pts += work`; if `build_pts ≥ required` → set state
     **active** (§4.3) and return done.
3. Done: if the building is a Farm (id 50), set the builder's timer to −1
   and stay in 7; the next step sees "timer < 0 and the farm holds food"
   and issues `do_command(farm)`, which turns the builder into a Farmer
   (`src/tact_bld.cpp:208-214`, `:227-230`). Any other building: state 3
   (wait for task).

Several builders on one site each call `build` in their own update, in list
order; speed adds linearly. Starting hp is 1, so hp reaches max a little
before the last point (`(required × (max_hp − 1) / max_hp)` points).

At the start of each update (`src/tact_bld.cpp:155-170`): a target that is
no longer unbuilt is either handed to repair (if `hp < max_hp`, as an AI
order with priority 100) or dropped (→ 3).

### 4.3 Completion (`TRIBE_Building_Object::set_object_state(active)`, `src/t_b_obj.cpp:229-327`, M)

In order:
1. `build_pts = required`.
2. **RNG:** `r = rand()`, play the construction sound for the local player
   only, `srand(r)` (`src/t_b_obj.cpp:235-245`).
3. `built = 1`; give flag-≥4 storages to the owner (`src/t_b_obj.cpp:198-206`):
   a House or Town Center adds 4 to attribute 4 (population headroom).
4. If `disappearsWhenBuilt`, the object removes itself; else re-explore,
   final sprite, connect walls (`:249-260`).
5. `on_build_make_obj`, `on_build_make_tile`, `on_build_make_tech`
   (`techId`, e.g. Town_Center1 → tech 105, Barracks1 → tech 62) run
   (`:262-294`).
6. Notify, register with the AI (`:296-300`).

`TRIBE_Building_Object::update` (`src/t_b_obj.cpp:334-363`) also sets the
construction frame `trunc(frames × build_pts / required)` and repeats the
`build_pts ≥ required` check while unbuilt. Losing the building later takes
the flag-≥4 storages back (`:303-307`).

**Building death (active → dying, `src/t_b_obj.cpp:303-327`, M).** Besides the
flag-≥4 storages (and the flag-2 storages every dying object returns, §6.3):
if the owner has no other *active* building of the same master, the building's
`techId` tech is undone (`undo_tech`), and so are the age techs **101, 102 and
103** (the same condition, whatever the building's type). The sim does this in
`objects.ts` `setObjectState`. Only an object that was active counts: a
foundation (unbuilt) that is cancelled or destroyed undoes nothing.

The farm's own food comes from its default task, the make action (§4.7).

### 4.4 Cancelling a foundation (`cancel_build`, `src/t_b_obj.cpp:672-697`, M)

`p = (required − build_pts) / required × 0.5`, capped at 1; `p = 0` if the
building is active or `hp ≤ 0`. For each cost slot with flag ≠ 0:
`attributes[type] += (float)(int) amount × p`. Then `hp = 0`. Constants
`g_build_cancel_refund_factor = 0.5`, `g_building_one_threshold = 1.0`,
`g_building_zero_hp = 0.0f` (`src/game_globals.cpp:315-317`).

### 4.5 Repair cost (`TRIBE_Building_Object::heal`, `src/t_b_obj.cpp:215-227`, M)

Given `h` build points of repair work: `hp_gain = h × max_hp / required`,
capped so `hp ≤ max_hp`; the player pays
`pay_obj_cost(id, hp_gain / (2 × max_hp), 0)`, i.e. half the building's
cost scaled by the fraction of hp restored; if unaffordable no hp is added.
Who calls it with what `h` is the repair action (not in this spec).

### 4.6 Placement and destructables (`check_placement`, `check_destructables`)

Ported from the decomp (`RGE_Master_Static_Object::check_placement`,
`src/m_s_obj.cpp:843`; `TRIBE_World::check_destructables`, `src/tworld.cpp:272`)
into `packages/sim/src/buildings.ts`. All geometry is float32.

`check_placement(master, x, y, construction, built_on)` returns 0 when the
master fits, else a reason code (7 off the map, 2 terrain, 6 an object in the
way). `do_command_build` calls it with `construction = 1` and `built_on = 1`
(`:194`); `place_obj` (§5.4) with both 0. Checks in order:
1. Footprint: `rx, ry` are the construction radii (`clearanceX/Y`) when
   `construction`, else the object radii. The box
   `[x − rx, x + rx − ε) × [y − ry, y + ry − ε)` (`ε` =
   `COORDINATE_EPSILON`) must lie inside the map, else 7.
2. Every tile under the box must allow the master's terrain restriction table
   (value > 0), else 2.
3. If both `rx` and `ry` are 0, or (not `built_on` and the master's `r_z` is
   0), stop with 0: such objects never collide with objects.
4. Objects within ±3 tiles (clamped to the map) are tested. Skipped: objects
   already pending removal or later; with `built_on`, an object whose
   `canBeBuiltOn` is 1 when the master's is 0 (**trees and corpses do not
   block a foundation**); objects with a zero radius in x or y; objects whose
   "has height" (`r_z > 0`) differs from the master's. For the rest, overlap
   is `|ox − x| < ox_r + rx` **and** `|oy − y| < oy_r + ry`; overlap returns 6.

`canBeBuiltOn = 1` in the civ 1 / Gaia tables used by the sim: Tree01, Tree08,
Tree10 (134, 141, 143), Tree_Stump1/2 (115, 130), every `Dead_*` corpse
(master type 30) and the Smoke_Battlex2/x3 effects (327, 328).

`check_destructables(player, master, x, y, 0)` runs in `TRIBE_Building_Object::setup`
(so for every foundation and every start building). If the master's radius is 0
in both x and y it does nothing. Otherwise, for each object in the ±3 box
whose master has `canBeBuiltOn ≠ 0`, is not of the same master id, and
overlaps (`|ox − x| < ox_r + r_x` and `|oy − y| < oy_r + r_y`, object radii, not
the construction radii), `destroy_obj` is called: the object is woken and set
**pending removal**; it is removed on its next update. Trees under a
foundation are therefore felled, not blocked, and a destroyed tree stays on
the obstruction map until it is actually removed (the sim's fuzz test
checks overlap among live objects only).

Placement visibility (reason 5) is ported for the build command and trained
units (visibility.md §5). The per-master centre and side tile requirements (1; the Dock's water centre and beach
beside it) are ported, naval.md §3.1. Not ported: slope (3; no type in the table that needs it).

### 4.7 Farms

Port: `packages/sim/src/make.ts` (the make action), `build.ts` (the builder's
hand-over), `gather.ts` (the Farmer's task requests), `unit-ai.ts`
(`civilianRetask`); vectors and flows in `farms.test.ts`; e2e
`e2e/tests/farm.spec.ts`.

**Requirement.** The Farm (master 50) is disabled in every civ's table. The
Market (84) has `techId` 26 ("Market"), whose effect 26 enables master 50
(command type 2, `a` 50, `b` 1) and runs once the first Market is built
(§4.3 step 5). The Market itself needs the Tool Age and a Granary (techs.md);
losing the last Market undoes tech 26 (§4.3), so the Farm button goes again.

**Building.** Farm (civ 1): `trainLocationId` 118 (the Builder: the
Villager's build menu), cost 75 wood and 1 of attribute 30, 30 build points,
50 hp, line of sight 4, radius 1.5 × 1.5 (3 × 3 tiles, stamped on the
obstruction map: units walk round it), button location 8, icon 10, name
string 5088, hotkey string 16089, selection sound 167, no dying sound,
construction sprite 82 ("Build 3x3", 4 frames by progress), standing sprite
273 ("Farm", one frame, one angle: the field looks the same however much food
is left; no code picks a frame by the amount). Storages: (0, 15, flag 0) is
the object's own starting load, so a foundation already holds 15 food of type
0; (30, −1, flag 2) the building allowance. Placement and construction are
those of any building (§4.1-4.6). A Farm is never repaired by a right click
(`src/ttsk_lst.cpp:85`, commands.md).

**Hand-over to the farmer** (`src/tact_bld.cpp:208-230`, D; decomp-marked bug,
§9). When `build` reports the Farm done, the builder's build action sets its
timer to −1 and stays in state 7. On each later update, while the timer is
below 0: if the Farm holds more than 0, the builder (waiting to move; leaving
its pathing group only for a computer player, `src/stat_obj.cpp:3254`) gets
`do_command(farm)`, i.e. `work2` (§3.1): the Villager becomes the Farmer
(259) with a gather action on the Farm; else `build` is called again, finds
the Farm no longer unbuilt, and the timer is set to −1 again. The build
action's timer is never reset to 0 (the start-of-update hand-off of a finished
target to repair or wait needs `timer == 0`), so a builder retargeted in that
window to another Farm foundation would be handed to it as a work order
instead of building it: kept as the original.

**Food: the make action** (`RGE_Action_Make`, `src/act_make.cpp`, M). The
Farm's task 0 (action 21, `resourceIn` 16, `work_val1` 1, `work_flag` 0) has
`is_default` 1, which makes it the master's `default_task`
(`src/m_ac_obj.cpp:130-140`). `RGE_Action_Object::update` (`src/act_obj.cpp:
403-407`): an object that is active and has no action calls
`set_task(default_task)` and does nothing more that step. So the Farm starts
on the first update after it is built (the step it completes, if its update
comes after its builder's in the list, else the next).
- `first_in_stack`: `set_state(6)` sets `timer = owner.attributes[36]`; a held
  type other than 16 becomes 0 of type 16 (the 15 food of type 0 go).
- `update`, state 6: if `timer ≤ 0` and `attributes[36] > 0`: when the held
  amount is ≤ 0, `notification(GAME_NOTIFY_OBJECT_DEPLETED, owner, id, x, y)`
  and `die_die_die` (hp 0); either way nothing grows. Otherwise
  `work = work_rate × dts` then `× work_val1` (float, in that order);
  `work_flag` 0: `set_attribute_amount(work, add, check_max)`, the held amount
  grows by `work`, clamped to `(float)(int)` the cap 15; `timer −= held −
  held_before`. (`work_flag` ≠ 0 would credit the owner's attribute
  `resourceIn` directly; no master has that.)
- With `attributes[36] ≤ 0` the timer is never checked: the Farm never runs
  out. Attribute 36 is 250 for every civ at the start; farm techs change it
  (out of scope here).
- The make action has no `stop`: `RGE_Action_Object::stop`
  (`src/act_obj.cpp:366-370`) deletes it, and the next update starts it again
  with `timer = attributes[36]`. A Farm alone has no Stop button (§ hud.md,
  the building branch shows Stop only for a queue or research), but a mixed
  selection with a unit that has an action does (`any_selected_have_action`
  counts the Farm's make action), and the stop command reaches the Farm: its
  food left is reset to the full 250. Decomp behaviour, kept;
  **unverified** in the retail exe.
- RNG: none in the action. The death draws as any object's (§7).

Rates: the Farm grows at most 0.4 food/s (`work_rate` 0.4) and stores at most
15; the Farmer (259, `work_rate` 0.45, carries 10) takes 0.45/s, so it
outpaces the Farm: the Farm empties and the Farmer stays on it (§3.4,
`keepGatheringWhenObjectIsOut`) taking `min(0.45 × dts, held)`. A Farm makes
250 food in all, plus the part of the last step's growth that takes the timer
below 0 (at most one step's `work`).

**Depletion.** The Farm dies through the normal dying path (hp 0 → dying,
death sprite none, the death-sound fence `rand`/`srand`, §7), returns its
flag-2 storage, and with nothing held becomes `Dead_Farm` (244, sprite 148,
holds 60 of type 12 decaying at 1/s, can be built on). A Farm destroyed by an
enemy goes the same way, its held food decaying at 10000/s (`resourceDecay`).

**The Farmer** (gather action 5, task unit 50, `targetDiplomacy` 1: own Farms
only, §3.2: another player's Farm ends the action). Sprites: walking 679,
`work_sprite` 468 "Man Farm" (29 frames, 8 angles) while in states 6-7,
carrying 829 "Carry Farmer" while holding at least 1 food, dead 257
Dead_Farmer. Drop sites 109 Town Center, then 68 Granary. When its Farm is
gone (pending removal), state 7 goes to 8 if it carries anything, else 3;
after a drop-off with the target gone it walks back to the remembered point
(11), then waits (3). Entering state 3, and every 10 s in it, the gather
action notifies its unit AI `REQUEST_TASK` (p1 GATHER, p2 the gather action's
`targetType`: the master id of the object it was made for, set only by the
constructor, `src/act_gath.cpp:38`). The civilian unit AI
(`src/taiuaimd.cpp:752-801`, L), when its current action is GATHER: target type
= `currentTargetTypeValue` (the object group set with the target: 3 for a
Farm), else `lastTargetTypeValue`; −1 → remove target, stop. A resource group
(`convertToLOSResourceType`) goes to `closestResourceObject` (§10). With
p2 = 50: `closestObject(type, any relation, ACTIVE, 50)` over the search
results; found → `gatherObject(id, 1)` (the gather action retargets; no check
that another Farmer works it, decomp-marked bug); not found and a human
player → `evasiveMoveTo(x ∓ 2.5, y ∓ 2.5)` (minus when the coordinate is above
5, else plus; float), the gather action takes the walk (state 15) and the
Farmer ends idle (state 2) as a Farmer. Computer players' Farmers stop
instead. The same notification for other gather and hunt targets takes the
re-task of §10.

**Gaia and ownership.** Farms are never Gaia's: they are built by a player.
The gather update ends (state 1, `TARGET_INVALID`) on a target owned by
another non-Gaia player, and the Farmer's task only matches own Farms.

**Sounds.** `GAME_NOTIFY_OBJECT_DEPLETED` (`src/tribegam.cpp:1728-1733`): for
the owner, if it is the local player, game sound 16 farmdie.wav and
`add_notification_loc(x, y)` (the last-event location; not ported). No
other sound: the Farm has no dying sound; built and selected play its master
sounds (sounds.md §3).

**UI.** The Farm's button is in the Villager's build menu (location 8) once
the Farm is enabled. The object panel of an own, active Farm with its make
action shows a food row (item icon 2):
`(int)(timer + held − g_tactical_panel_rounding_offset)`, the offset −0.5
(`src/tpnl_obj.cpp:474-484`, `src/game_globals.cpp:381`), i.e. the food left;
the Farm's held amount is not shown as a resource row (`:495`). Cursor
(`get_mouse_pointer_action_vars`, `src/tplayer.cpp:3714`): a Villager over an
own Farm reads action 5 (repair/build) of the right-click table, which needs
hp below the maximum; an intact Farm falls back to the left-click table:
the arrow and "Click to select" (decomp-marked bug), though a right click
works it. A foundation or a damaged Farm shows the hand (facet 3).

### 4.8 Walls: the line command, joining and the next foundation

Masters 72 (Small Wall), 117 (Medium Wall) and 155 (Large Wall) are buildings
of object group 27 with `adjacentMode` (`building_connect_flag`) 1; no other
master in the dat has it. RoR 1.0a `data2/empires.dat`, civ 1: cost 5 stone
(flag 1), `build_pts_required` (`trainTime`) 7, radius and construction
radius 0.5 × 0.5, construction sprite 77 (4 facets), standing sprites 825
(Small: 6 frames, 3 facets, flags 7), 259 (Medium) and 254 (Large) (1 frame,
3 facets, flags 2), `building_facet` 0. AoE1 has no gate. Tech 13 (Medium
Wall, effect 13) upgrades 72 to 117 (type 3, `copy_obj`): master 72 becomes a
copy of 117 that keeps id 72.

#### 4.8.1 The line command (`TRIBE_Command::do_command_build_wall`, `src/tcommand.cpp:239-296`, M)

Sent by `TRIBE_Player::command_make_wall` (`src/tplayer.cpp:884-896`, M) when
the master is `available` and the selection has objects of group 4 (the
Villagers): `command_build_wall` (`src/tcommand.cpp:668-718`, M) carries the
unit ids, the master id and two **tiles** `(x1, y1)` (where the drag started)
and `(x2, y2)` (where it ended), each clamped to 0..255 and stored as a byte;
the command's owner is the first unit's. The UI end is
`TRIBE_Main_View::command_place_multi_object` (`src/tvw_main.cpp:276-330`, M),
outside the sim.

On execution, with `dx = |x2 − x1|`, `dy = |y2 − y1|`:
- `dy == dx` (a diagonal, or one tile): one leg `(x1, y1) → (x2, y2)`.
- `dy > dx`: leg `(x1, y1) → (x1, y2)` down the start column, then, when
  `x1 ≠ x2`, leg `(x1 ± 1, y2) → (x2, y2)` along the end row from the tile
  after the corner.
- `dx > dy`: leg `(x1, y1) → (x2, y1)` along the start row, then, when
  `y1 ≠ y2`, leg `(x2, y1 ± 1) → (x2, y2)` down the end column.

So a drag that is not a straight or 45° line becomes an L whose corner is on
the longer axis' far end.

Each leg is `place_line_of_walls` (`src/tcommand.cpp:298-341`, M; the decomp
names the steps `y_skip`/`x_skip` and swaps `x1`/`y1`, but the walk is): start
at tile `(x, y) = (ax, ay)`, steps `sx = sign(bx − ax)`, `sy = sign(by − ay)`;
loop:
1. At `(x + 0.5f, y + 0.5f)` call `check_placement(player, wx, wy, 0,
   check_vis 1, check_flat elevation_flag, check_overlay 0, construction 1,
   built_on 1, check_objects 1)` (§4.6). A tile that fails is **skipped**:
   no segment, no cost.
2. A tile that fits: `pay_obj_cost(id, 1.0, 0)` (§6.1). When the player
   cannot pay, the leg **ends** there (the second leg is still tried, and
   stops at its first fitting tile for the same reason).
3. `make_new_obj(player, wx, wy, 0, unique_id)`: a foundation (§4.1, setup
   draws as any object). The first segment made by the command is kept.
4. Stop after the tile `(bx, by)`; else `x += sx`, `y += sy`.

A segment placed earlier does not block the next: walls are 0.5 radius and
one tile apart. Then, when a segment was made and units were listed, each
unit is `removeAllFromPathingGroup` and `do_command(first, first.x,
first.y)`: every builder goes to the **first** segment only; the rest of the
line is taken up through the task request (§4.8.3). The command is not
checked against the units' owner in the original; the port's guard (§5.5)
ignores units not the sender's and charges the sender.

#### 4.8.2 Joining (`TRIBE_Building_Object::connect`, `src/t_b_obj.cpp:535-583`, M)

**When.** `set_object_state(active)` (§4.3), right after the final sprite and
`facet = building_facet`, calls `connect()` when the master's
`building_connect_flag` is set (`src/t_b_obj.cpp:253-259`), and so does
`TRIBE_Building_Object::copy_obj` (an upgrade, `src/t_b_obj.cpp:757-766`, M)
at its end, with the object's old master. Nothing else does: a wall that is
destroyed or cancelled does **not** re-join the walls next to it; they keep
their facets until a wall next to them is built or they are upgraded.
Placing a foundation does not join either.

**Neighbours** (`check`, `src/t_b_obj.cpp:465-533`, M): with
`(x, y) = ((short)world_x, (short)world_y)`, the tiles north `(x, y − 1)`
(when `y > 0`), west `(x − 1, y)` (`x > 0`), east `(x + 1, y)`
(`x < width − 1`), south `(x, y + 1)` (`y < height − 1`). On each, the
first object in the tile's list whose master id is the wall's own
(`find_by_master_id(id, −1, −1, 0, 0, 0)`, `src/obj_list.cpp:370`, M: any
state, any owner) is the neighbour, dropped when its owner differs. So a
foundation counts, a dying wall still on the tile counts, only walls of the
same master id join (after the upgrade every wall is still master 72), and
another player's wall never joins.

**Facet.** `connect`, on a wall whose current sprite has exactly 3 facets
(else `facet = 0` and nothing more):
1. `set_angle()`: `facet` from the object's angle (the random angle drawn at
   setup, movement.md §9).
2. Choose `k`: north and south neighbours and neither west nor east → `k = 1`;
   west and east and neither north nor south → `k = 0`; anything else (an end
   with one neighbour, a corner, a T, a crossing, a wall alone) → `k = 2`.
3. `RGE_Moving_Object::rotate(k − facet)` (`src/move_obj.cpp:2141-2160`, M;
   the building's own `rotate` override is empty and is bypassed):
   `angle2 = (float)((double)amount × 6.2831853 / facet_num) + angle`, wrapped
   into `[0, 6.2831853)`, then `new_angle` → `set_angle`. The facet becomes
   `k`.
4. Each neighbour found runs `connect2`: the same facet choice from its own
   neighbours, from its current `facet` and without `set_angle`, and without
   recursing further. A neighbour that is a foundation shows the construction
   sprite (4 facets), so `connect2` sets its facet to 0; its construction
   update then sets the build frame again (§4.3).

Example, a line built west to east: the two ends show facet 2, every segment
between them facet 0; a line north to south: ends 2, middle 1; an L: the
corner 2. `facet` is the object's sprite facet, drawn as is
(`RGE_Static_Object::draw`); `TRIBE_Master_Building_Object::draw` (the
placement ghost, `src/tm_b_obj.cpp:203-216`, M) draws a connecting master's
facet `f` as sprite facet `f − 1`, and 0 as 2.

#### 4.8.3 The builder's next foundation (`TribeCivilianUnitAIModule::processNotify`, `src/taiuaimd.cpp:811-825`, L)

`TRIBE_Action_Build::set_state(3)` (`src/tact_bld.cpp:56-76`, M) on a human
player's unit notifies its unit AI `UNIT_AI_NOTIFY_REQUEST_TASK` with
`p1 = UNIT_AI_ACTION_BUILD`; state 3 follows a finished building, a target
that is no longer unbuilt, or a walk to it that failed. With the AI's
current action `BUILD`:
1. `closestObject(currentTargetType, 3, UNBUILT, −1)` (`src/aiuaimod.cpp:1506`,
   M; relation 3 = the searcher's own objects only): the nearest own
   foundation of the group the unit was building (27 for a wall, 3 for a
   building) among its search results (unit-ai.md §3.2; the Builder's search
   radius is twice its line of sight, at most 15).
2. None: the same for the other of the two groups (a wall's builder looks for
   buildings, a building's for walls).
3. Found and `canPath(id, 1.0)`: `buildObject(id, 1)` — the build task on it,
   current action BUILD, target that object with its group and position
   (`src/aiuaimod.cpp:1901-1918`, M).
4. Otherwise: when the last target is gone or farther than 1.0
   (`distance_to_object`), `moveTo(target point, 1.0)`. The unit stays a
   Builder waiting.

So builders walk the line segment by segment, nearest first (ties: the first
search record), and after the line any other own foundation nearby. This
applies to every building, not just walls.

#### 4.8.4 Port status

Ported: §4.8.1 (`World.doCommandBuildWall` / `placeLineOfWalls`, command
`build-wall` with byte tiles), §4.8.2 (`buildings.ts` `connectWall`,
`wallNeighbours`; on completion and in `techs.ts` `copyObject` through
`TechContext.connectWall`), §4.8.3 (`build.ts` state 3 notify,
`unit-ai.ts` `civilianRetask`). `check_flat` is not checked (slope, §4.6),
as for any building. The client's drag line and `draw_wall_outline`
(`src/tvw_main.cpp:21`, `:204`, `:276`) are ported (docs/spec/hud.md, the
wall bullets under the placement ghost; `apps/client/src/units/placement.ts`
`wallOutline`, `unit-layer.ts`). Tests: `packages/sim/src/walls.test.ts`,
`apps/client/src/units/placement.test.ts`, e2e `e2e/tests/walls.spec.ts`,
`e2e/real/real-walls.spec.ts`.

## 5. Training

### 5.1 Production queue (the human UI path)

The UI train button sends `command_queue` because `production_queues_is_use`
is 1 (`src/scr_game.cpp:4253-4260`, M; `src/game_globals.cpp:107`).
`do_command_queue` (`src/tcommand.cpp:530-539`, M): positive count → add,
negative → remove. Neither checks that the unit is trained at this
building (`trainLocationId`) — decomp-marked bug. Nor do they check who owns
the building: see §5.5.

`add_to_production_queue(id, n)` (`src/t_b_obj.cpp:800-860`, D):
- If the queue is empty or its **last** record is a different unit, every
  existing record is removed first with refunds (the queue holds one unit
  type at a time), then the cost is checked once with `ignore_pop = 1`; if it
  fails, stop. A new record is appended.
- For each of the `n` units: check cost (`ignore_pop` 1); stop at the first
  failure; else `pay_obj_cost(id, 1.0, 1)` and count it. Units are paid
  when queued.
- Same unit as the last record: just the per-unit loop on that record.

`remove_from_production_queue(id, n)` (`src/t_b_obj.cpp:862-920`, M) refunds
`min(n, count)` units with `reimburse_obj_cost`, then subtracts **n** from
the count; a record at ≤ 0 is removed; removing record 0 also stops and
deletes the running train action.

`update_production_queue` (`src/t_b_obj.cpp:959-1029`, M), called by the
building's update after its own action list (`src/t_b_obj.cpp:356-361`):
1. Disabled or empty: nothing.
2. If the building's main action list is training or researching (action
   type 0x66 / 0x67): the whole queue is removed **without refunds**
   (`:1024-1027`): `remove_from_production_queue(first id, -1)` refunds
   `min(count, -1)` = no unit and subtracts −1, so the record's `short`
   count climbs until it wraps to −32768 and the record goes; at index 0
   the queue's train action is stopped and deleted (pre-paid, nothing
   back). Port: `updateQueue` empties the queue while `e.research` exists
   (`techs.md` §3.6).
3. Else, if no train action exists: if `population ≥ population_limit`
   wait (attribute 32 needed); else if `headroom > 0` create
   `TRIBE_Action_Make_Obj(first id, pre_paid = 1)` and add it; else wait
   (attribute 4 needed) (`:976-1016`).
4. Update the train action; on removed/completed/failed, drop it and
   `advance_production_queue` (count −1, record removed at 0)
   (`:1018-1023`).

Because step 3 adds the action and step 4 updates it in the same call, the
first increment of training happens in the **same step** the action is
created, and the next unit starts in the step after one finishes.

### 5.2 Train progress (`TRIBE_Action_Make_Obj::update`, `src/tact_mob.cpp:102-152`, M)

- `work_done = work_rate(building) × dts + work_done` (1000 with
  `quick_build`) (`:107-112`). The **building's** `workRate` is used
  (Town_Center1: 1).
- When `(float) trainTime(unit) ≤ work_done`: state 1, `place_obj` (§5.4).
  Placement failure: refund the cost, notify "no room", remove.
  Success: notify, remove (`:116-150`).
- Progress shown: `(int)(work_done × 100 / trainTime)` (`:247-263`).

### 5.3 Direct make (`do_command_make`, `src/tcommand.cpp:104-138`, M)

Used by AI and scripted code (`TRIBE_Player::trainUnit`,
`src/tplayer.cpp:1547`). If the building's current action is not train or
research, it replaces the building's actions with a not-prepaid
`Make_Obj`, which pays `pay_obj_cost(id, 1.0, 0)` in `first_in_stack`
(`src/tact_mob.cpp:73-88`, **N**) and cancels if unaffordable. `stop` refunds
it unless pre-paid (`src/tact_mob.cpp:225-244`).

### 5.4 Placing the trained unit (`place_obj`, `src/tact_mob.cpp:161-222`, M)

- `rx = building.r_x + unit.r_x − (−0.01)`, same for `ry`
  (`g_make_obj_radius_adjustment = −0.01f`, `src/game_globals.cpp:340`);
  `rx2 = rx + rx`.
- Up to 3 rings × 60 tries. Each try:
  1. **RNG draw A:** side `d = (A × 2) / 32767` (integer division) for tries
     0–39, `d = (A × 2) / 32767 + 2` for tries 40–59 (`:178-182`).
     So `A ≤ 16383` → 0, `16384 ≤ A ≤ 32766` → 1, `A = 32767` → 2 (and +2
     in the late tries, so `A = 32767` gives side 4, which matches no case).
  2. **RNG draw B** (for sides 0–3): offset
     `B × side_len × 3.051851e-05f − r` (`g_make_obj_random_scale`,
     `src/game_globals.cpp:341`; about 1/32767):
     side 0: `y = cy + ry`, `x = cx + off(rx2, rx)`; side 1: `x = cx − rx`,
     `y = cy + off(ry2, ry)`; side 2: `x = cx + rx`, `y = cy + off(ry2, ry)`;
     side 3: `y = cy − ry`, `x = cx + off(rx2, rx)` (`:183-204`).
     Side 4 draws nothing and reuses the previous target.
  3. `check_placement` of the unit master there; 0 = free → `make_new_obj`
     at `(x, y, building.z)` and stop (`:205-211`). Else count a failed try.
- After 60 failed tries, grow: `rx += 2 × unit.r_x`, `rx2 += 4 × unit.r_x`
  (same for y) (`:214-218`). After 3 rings: fail.

So in the first 40 tries only the `+y` edge (side 0) and the `−x` edge (side 1)
are used, except for `A = 32767`; tries 40–59 use the `+x` and `−y` edges.
Whether `check_placement` itself draws random numbers is **unverified**.

### 5.5 Port-side guard: other players' objects

`do_command_queue` and `do_command_cancel_build` look the object up by id and
**never compare its owner with the sender**, so in the original a player can
queue units at, or cancel (or kill, §4.4) the opponent's buildings. The UI
never sends such commands; online, only a tampered client could, and that
would be a cheat. Deviation from the original (**port decision**, Mate
decision 2026-11-15, PROJECT.md "Captain's decisions"): `World` ignores a
`queue` or `cancel` command whose target object is not owned by the sender.
The command still counts as executed: the per-command `rand()` of §7 is drawn
before the check, exactly as for an accepted command, so every peer's stream
stays the same whether or not a command was accepted. The same guard class as
the other port-side checks (queue needs an object with a queue, cancel needs
master type ≥ 50).

## 6. Costs and owner attributes

### 6.1 `check_obj_cost` / `pay_obj_cost` / `reimburse_obj_cost` (`src/tplayer.cpp:1031-1115`, M)

`check_obj_cost(id, modifier, ignore_pop)`; for each of the 3 cost slots
with `type ≥ 0`, `cost = amount × modifier`:
- type 4 (headroom) and not `ignore_pop`: fail if `population ≥ population_limit`.
- If gold replacement is on (`attributes[29] ≥ 1`), gold costs are also
  checked against a running "gold left" figure, and a missing amount of a
  flagged slot may be covered by gold. Off by default (**inferred**: civ
  start value of attribute 29 is 0).
- Fail if `attributes[type] < cost`, unless (type 4 and `ignore_pop`).
  Flag-0 slots are checked like any other.

`pay_obj_cost` re-runs the check, then subtracts every **flag ≠ 0** slot
(skipping type 4 when `ignore_pop`); if a slot exceeds the stock (only
possible with gold replacement) the rest comes out of gold.
`reimburse_obj_cost` adds back `amount` (no modifier) of every flag ≠ 0
slot, including type 4 — no current unit has a flagged type-4 cost, so the
asymmetry is latent.

With the villager's costs: 50 food is paid; the "1 of attribute 4" slot is
flag 0, so headroom is only checked, never paid.

### 6.2 Resources are floats

All resource stocks and loads are `float` (`include/player.h:457`,
`include/stat_obj.h:460`). Deposits add the exact float load; nothing rounds
to integers. The UI rounding is presentation only.

### 6.3 Storages applied to the owner

- On object creation, storage slots with flag 1 or 2 are added to the
  owner (`give_attribute_to_owner`, `src/stat_obj.cpp:445-456`, D;
  called at `src/stat_obj.cpp:261`); on removal, flag-2 slots are taken
  back (`src/stat_obj.cpp:458-468`, D). A villager therefore makes headroom
  −1, population +1, total units +1, and on death returns headroom and
  population.
- Flag 0 is the object's own starting load (`get_starting_attribute`,
  `src/stat_obj.cpp:419-443`).
- Flag ≥ 4 is given when a building completes and taken when it dies
  (§4.3).

### 6.4 Attributes 30, 32, 33 and 45 are set by `new_game`

Attribute 30 is the **building allowance** (every building master has a
`[30, −1, 2]` storage, so creating one takes 1 and its death returns 1; a
cancelled Barracks goes 500 → 499 → 500) and 32 the **population limit**.
Neither comes from a start tech or the civ table as one might expect:
- The civ table's attribute 32 is 0, and the Stone Age start tech only *adds* 8
  to attribute 30.
- After the start objects are placed, `TRIBE_World::new_game` sets for every
  player except Gaia (players 1 and up) `attributes[32] = population limit`
  (`RGE_Game_Info` default **50**; the lobby's Population Limit, 25 to 200,
  `lobby.md` §2; the port's `populationLimit` option), `attributes[33] = 0`, `attributes[30] = 500` and
  `attributes[45] = 1`. These overwrite the start techs' values.

Training is capped twice (§6.1): by headroom (attribute 4, `+4` per House or
Town Center) and by `population` (attribute 11) against the limit in attribute
32, which stops training even when headroom is left.

## 7. RNG calls in this subsystem, in order

| when | draws | ref |
| --- | --- | --- |
| each command executed (build, queue, make, work, …) | 1 `rand()`, value unused, before dispatch | `src/tcommand.cpp:37` |
| building completes | 1 `rand()` = r, then `srand(r)` | `src/t_b_obj.cpp:235-245` |
| trained unit placement, per try | 1 (side) + 1 (offset) for sides 0–3; 1 for side 4 | `src/tact_mob.cpp:179-202` |
| any object created (trained unit, foundation, …) | 1 `rand()` per random start frame of its sprite (a Villager's standing sprite: 1), **before** the fence; then 1 `rand()` = r and `srand(r)` at the end of `RGE_Static_Object::setup`; an object that can move then draws once for its facing (`movement.md` §11) | `src/stat_obj.cpp:279-286` |

Gathering, drop-off, construction progress, the queue and costs draw
nothing. The `srand(r)` fences make the stream after them depend only on the
15-bit `r` (`core.md` §4.2); the port must perform the draw and the reseed.
Subclass `setup`/`make_new_obj` paths beyond `RGE_Static_Object::setup` may
draw more — **unverified**.

## 8. Worked examples (test vectors)

Common inputs: one world step of 50 ms, so
`dts = fround(50 × fround(0.001)) = 0.05000000074505806`. Float values are
IEEE single (`Math.fround` after every operation and store). The two
precisions in `core.md` §3 (round after each operation vs. extended
intermediates rounded at the store) were both computed; they agree except
where noted. Computed with a scratch script, not with the game.

### 8.1 Vector E1: gold miner fills up and drops off

Miner-Gold (251) of a civ without a gold bonus (the Egyptian civ effect
adds 0.2 work rate and 2 capacity; the test plays the Greeks): `workRate`
0.45f, `workValue1` 1, cap 10,
`resourceMultiplier` 47 with `attributes[47] = 1`; target Mine-Gold (66),
400 gold, Gaia-owned; miner already facing the mine (state 7).

- Per step: `give = fround(fround(1 × 0.45f) × dts) = 0.022499999031424522`;
  `m = 1`; `adj = give`.
- Steps 1–444: no clamp; held rises by `adj`.
- Step 445: step 5 of §3.3 clips the take; **held = 10.0 exactly**; state → 8.
- Mine after step 445: **390.0038146972656** (not 390: each `−give` is
  rounded at the mine's magnitude).
- Deposit at the Town Center: `attributes[3] += 10.0`,
  `attributes[49] += 10.0`; miner holds (−1, 0).

Refs: `src/act_gath.cpp:347-381`, `:418-424`; `src/tplayer.cpp:3661-3664`.

### 8.2 Vector E2: one builder raises a Barracks

Builder (118): `workRate` 1, `workValue1` 1; Barracks1 (12): `trainTime`
30, hp 350; new foundation (`build_pts 0`, `hp 1`).

| step | build_pts | hp (round each op) | hp (round at store) |
| --- | --- | --- | --- |
| 1 | 0.05000000074505806 | 1.5833332538604736 | 1.5833333730697632 |
| 2 | 0.10000000149011612 | 2.1666665077209473 | 2.1666667461395264 |
| 300 | 15.000039100646973 | 175.9998016357422 | 175.9998016357422 |
| 599 | | 350 (first clamp) | 350 (first clamp) |
| 601 | 30.0 (clipped last work) | 350 | 350 |

- `build_pts` reaches 30 at **step 601**, not 600: the float sum of 600
  increments of 0.05 stays below 30, and step 601's work is clipped to the
  remainder.
- Step 601: completion (§4.3) with one `rand()`/`srand` pair; the builder
  goes to state 3.
- Step 1 differs between the two precisions in the last bit; a golden
  test must pin which precision the port uses (`core.md` §3, unverified).

Refs: `src/tact_bld.cpp:216-232`; `src/t_b_obj.cpp:144-163`, `:700-717`,
`:229-245`.

### 8.3 Vector E3: Town Center trains a villager and places it

Town_Center1 (109) at centre (20.5, 20.5), `workRate` 1; one Man (83)
queued with 200 food, headroom ≥ 1, population below the limit.

- Queue command (step 1): one `rand()` in `do_command`; cost check passes;
  food 200 → **150**; headroom unchanged (flag-0 slot).
- Same step 1: train action created and first increment applied.
  `work_done` after step n = n increments of `fround(1 × dts)`.
- `work_done ≥ 20` first at **step 401**: `work_done = 20.04998016357422`.
- Placement, with the RNG at state `srand(14)` when `place_obj` starts
  (stream 84, 27125, 9192, …, `core.md` §4.3):
  - `rx = ry = fround(fround(1.5 + 0.2f) + 0.01f) = 1.7100000381469727`,
    `rx2 = 3.4200000762939453`.
  - Draw A = **84** → `168 / 32767 = 0` → side 0: `y = 20.5 + 1.71 =`
    **22.209999084472656**.
  - Draw B = **27125** → offset `= 27125 × 3.42 × 3.051851e-05 − 1.71`
    = 1.1211258172988892 (round at store) or 1.1211256980895996 (round
    each op); `x = 20.5 + offset =` **21.621126174926758** in both.
  - If the spot is free the unit is created, and `RGE_Static_Object::setup`
    draws in this order (**corrected**: an earlier version of this text took
    9192 for the fence):
    1. **9192**, the third value of the stream: the standing sprite's random
       start frame, drawn by `new_sprite` *before* the setup fence;
    2. **11643**, the fourth value: the setup fence, `srand(11643)`;
    3. **5291**, the first value after that reseed: the unit's facing
       (`movement.md` §11, objects that can move);
    4. the next draw in the step is **10423**.
    (Stream `srand(14)`: 84, 27125, 9192, 11643, 22187, 1235, …; after
    `srand(11643)`: 5291, 10423, 2522, …. Vector test: `packages/sim/src/buildings.test.ts`,
    `economy.md §8.3 vector E3`, which checks the first three stream values,
    the Villager's position and the draw after the facing.)
  - Owner effects: headroom −1, population +1, total units +1 (§6.3).
- Side mapping edge cases for draw A: 16383 → 0, 16384 → 1, 32766 → 1,
  32767 → 2.

Refs: `src/t_b_obj.cpp:800-860`, `:959-1019`; `src/tact_mob.cpp:102-152`,
`:161-222`; `src/stat_obj.cpp:279-286`.

### 8.4 Vector E4: cancelling a Barracks at 12 build points

`p = fround((30 − 12) / 30 × 0.5) = 0.30000001192092896`; refund
`125 × p = 37.5` wood (the attribute-30 slot has flag 0 and is not
refunded). Ref: `src/t_b_obj.cpp:678-697`.

## 9. Known decomp-marked bugs that matter here

Kept as behaviour unless §5.5 says otherwise (queue and cancel owner check).

Kept as behaviour (the target is the original game):
- Training at the wrong building: neither queue nor make checks
  `trainLocationId` (`src/tcommand.cpp:115-116`, `:534`). The UI only offers
  valid buttons, so it is reachable only by a hand-made command; the
  server/peer should reject such commands (**port decision**, not the
  game's).
- Farm completion arms the builder to farm immediately and discards a
  non-food load (`src/tact_bld.cpp:224-230`, `src/act_gath.cpp:59`). The
  build action's timer stays at −1 after the hand-over (§4.7).
- A Farmer whose Farm is gone takes the closest active Farm with no check
  that another Farmer works it (`src/taiuaimd.cpp:785`, §4.7).
- A Villager over an own intact Farm shows the arrow, not the hand
  (`src/tplayer.cpp:3714`, §4.7).
- `update_production_queue` step 2 calls `remove_from_production_queue`
  with count −1: the refund loop runs 0 times and the count goes **up** by
  1 per call (`src/t_b_obj.cpp:1024-1027`, `:872-884`). The count is a
  `short` (`include/t_b_obj.h:8-11`), so it wraps to −32768 after at most
  32 767 calls and the record is removed: the loop ends, nothing is
  refunded (§5.1). A research command is accepted with units queued
  (`techs.md` §3.6), so the path is reachable by command; whether the UI
  offers it is **unverified**.
- Train actions destroyed with their building never tell the AI
  (`src/tact_mob.cpp:36-45`); AI-only.

## 10. Undocumented or not ported

- **Animal wander (action 6).** Specified in `unit-ai.md` §5.5 and ported
  (`bird.ts`): the second default task the sim starts after the make action
  (21, the Farm's, §4.7).
- **Task requests of gatherers (ported, `unit-ai.ts` `civilianRetask`).** A
  waiting gather or hunt action notifies its unit AI `REQUEST_TASK` (§4.7); a
  `TARGET_INVALID` for the current action takes the same path
  (`src/taiuaimd.cpp:707-863`). HUNT or GATHER: the target group is the
  current target's, else the last one's (−1: remove the target, stop, tell
  the owner). A resource group (`convertToLOSResourceType`: forage 7 → list
  1, gold 32 → 4, stone 8 → 3, trees 15 → 0, fish 5/31/33 → 2) is looked up
  with `closestResourceObject` (unit-ai.md §3.4), a Farm's request with
  `closestObject(group, any, ACTIVE, 50)`, anything else with
  `closestObject(group, any, any)` over the search results. Found →
  `huntObject`/`gatherObject(id, 1)`; failing that, the unit stops. Not found:
  a human player's Farmer steps off (§4.7), any other waits where it is. BUILD:
  the builder's next foundation (§4.8.3). EXPLORE is not ported (no explore
  action). Then a request ends; an invalid target ends the work
  (`action_finished`): remove the target, stop, tell the owner. Computer
  players' branches are not ported. Tests `retask.test.ts`.
- **Farm depleted location.** `add_notification_loc` (the last-event spot)
  is not ported; farmdie.wav is (sounds.md §5).
- The `fog_update` `rand()` at player creation and placement visibility are
  ported (visibility.md §5, §6).
- Not ported: the civ effect;
  per-civ masters (Gaia's records use other graphics and enabled flags, and
  the Greek Granary other graphics); slope and tile
  requirements (§4.6); master-attribute effect codes other than 17; research.
