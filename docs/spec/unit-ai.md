# Unit AI: idle behaviour, auto-attack, reactions

Source: aoe1-decomp @ `6d6d8b1` (July 1998 RoR beta; see `README.md` for the
version caveat and reference format). Status letters: M matching,
D accepted_drift, L accepted_logic, N nonmatching, taken from
`config/functions/src/<file>.cpp.json` in the clone (not from `INDEX.md`).

Scope: the per-unit "unit AI" that every combat object carries
(`UnitAIModule`, `src/aiuaimod.cpp`, and the per-class subclasses in
`src/taiuaimd.cpp`): when it runs, how it reacts to being attacked, how an
idle unit picks something to attack, what it does when its target dies, and
every random draw it makes. Not covered: the actions it starts (attack,
gather, move: combat/economy/movement specs), group/playbook logic and the
computer-player modules (M5). Computer-player-only branches are listed only
so the port knows they are dead in a game of two humans (§1.4).

## 1. Who has a unit AI and when it runs

### 1.1 Which AI class an object gets

`TRIBE_Combat_Object::initUnitAI` (`src/t_c_obj.cpp:692`) picks the class
from the master's `object_group` (in `empires.dat` this is the unit field
`class`; `@aoe/data` `Unit.class`). It is called from
`TRIBE_Combat_Object::setup` (`src/t_c_obj.cpp:68-76`, after the base
`RGE_Static_Object::setup` chain), so only combat objects (dat `type` 50
and up: units type 70, buildings type 80) have one. Birds (type 40) do not.

| `object_group` (dat `class`) | master id condition | AI class | ref |
| --- | --- | --- | --- |
| 1 artifact | not id 99 and not id 10 | `TribeArtifactUnitAIModule` (queue 5) | `src/t_c_obj.cpp:695-698` |
| 4 civilian | | `TribeCivilianUnitAIModule` | `:700-701` |
| 18 priest | | `TribePriestUnitAIModule` | `:703-704` |
| 9 hunted animal | | `TribeHuntedAnimalUnitAIModule` | `:706-707` |
| 10 predator | id 157 (horse) | `TribeHuntedAnimalUnitAIModule` | `:710-711` |
| 10 predator | id 48 (elephant) | `TribeElephantUnitAIModule` | `:712-713` |
| 10 predator | id 126 (lion) | `TribeLionUnitAIModule` | `:714-715` |
| 10 predator | any other | `TribePreditorUnitAIModule` | `:716-717` |
| 21 fishing boat | | `TribeFishingShipUnitAIModule` | `:720-721` |
| 2 trade boat | | `TribeTradeShipUnitAIModule` | `:723-724` |
| 20 transport boat | | `TribeTransportShipUnitAIModule` | `:726-727` |
| 3 building, 27 wall | ids 79, 199, 69, 278, 383, 380 (towers) | `TribeTowerUnitAIModule` | `:729-734` |
| 3 building, 27 wall | any other | `TribeBuildingUnitAIModule` | `:735-736` |
| 5, 7, 8, 11, 14, 15, 16, 29, 30, 31, 32, 33 | | none | `:739-751` |
| anything else (all military) | | `TribeSoldierUnitAIModule` | `:752-753` |

`TribeRangedUnitAIModule` exists (`src/taiuaimd.cpp:353`) but nothing
creates it: archers get the soldier AI.

Real classes from the captain's `empires.dat` (Gaia civ 0 for animals,
civ 1 Egyptian for the rest; read with `@aoe/data` `parseDat`):

| id | dat name | class | AI | LOS | speed | hp |
| --- | --- | --- | --- | --- | --- | --- |
| 83 | Man (villager) | 4 | civilian | 4 | 1.1 | 25 |
| 73 | Soldier-Inf1 (clubman) | 6 | soldier | 4 | 1.2 | 40 |
| 4 | Soldier-Archer1 (bowman) | 0 | soldier | 7 | 1.2 | 35 |
| 299 | Soldier-Scout | 12 | soldier | 8 | 2.0 | 60 |
| 35 | Soldier-Catapult1 | 13 | soldier | 13 | 0.8 | 75 |
| 125 | Priest | 18 | priest | 12 | 0.8 | 25 |
| 79 | Watch_Tower | 3 | tower | 8 | 0 | 100 |
| 109 | Town_Center1 | 3 | building | 7 | 0 | 600 |
| 65 | Gazelle | 9 | hunted | 2 | 1.1 | 8 |
| 157 | Horse | 9 | hunted (class 9, so the id-157 row above never fires) | 5 | 2.0 | 20 |
| 48 | Elephant | 10 | elephant | 4 | 1.0 | 45 |
| 126 | Lion | 10 | lion | 3 | 1.1 | 20 |
| 1 | Alligator | 10 | generic predator | 5 | 0.5 | 20 |
| 89 / 90 / 362 | Lion_King / Elephant_King / Alligator_King | 10 | generic predator | 5 / 4 / 8 | | |

### 1.2 Construction and its random draws

The base constructor (`src/aiuaimod.cpp:18`, M) sets: `idleTimeout = 3000`
ms, `lookAroundTimeout = 1000`, `desiredTargetDistance = 2.0`,
`defenseBuffer = master LOS`, an attackers list with room for 10, and then
calls `setAdjustedIdleTimeout` (`:40`). Several subclass constructors then
set their own `idleTimeout` and call it **again** (`src/taiuaimd.cpp`):

| class | idleTimeout (ms) | `setAdjustedIdleTimeout` calls at creation | ref |
| --- | --- | --- | --- |
| base / civilian / priest / predator / elephant / ships / tower / building | 3000 | 1 | `src/aiuaimod.cpp:24`, `:40` |
| hunted animal | 4000 | 2 | `src/taiuaimd.cpp:35-36` |
| lion | 6000 | 2 | `src/taiuaimd.cpp:255-256` |
| soldier | 1500 | 2 | `src/taiuaimd.cpp:1671-1672` |
| artifact | 5000 | 2 | `src/taiuaimd.cpp:1928-1929` |

`setAdjustedIdleTimeout` (`src/aiuaimod.cpp:2420`, M) draws one `rand()`
(`debug_rand`, line tag 3916) and sets, in unsigned integer arithmetic:

> `adjustedIdleTimeout = r % (idleTimeout >> 1) + ((idleTimeout * 3) >> 2)`

so the adjusted timeout lies in `[0.75 T, 1.25 T)`: 3000 → 2250..3749,
1500 → 1125..1874, 4000 → 3000..4999, 6000 → 4500..7499.
It is drawn once per object (plus again for the lion, §5.3) and never
re-drawn when the idle timer fires.

**Order of draws when a combat object is created** (`r` = `rand()`):
`RGE_Static_Object::setup` draws `r0` and immediately `srand(r0)` around the
creation sound (`src/stat_obj.cpp:280-286`); later in the same setup chain
`TRIBE_Combat_Object::setup` → `initUnitAI` constructs the AI, which draws
one (civilian, tower, building, ...) or two (soldier, hunted, lion,
artifact) more `rand()` values (`src/t_c_obj.cpp:76`). These AI draws are
**not** fenced: they advance the shared stream. Between the fence and
`initUnitAI`, a moving object with a facing sprite (`facet_num > 1`) draws
one facing `rand()` (`src/move_obj.cpp:150-169`, `:222`, called by
`RGE_Moving_Object::setup`, which `TRIBE_Combat_Object::setup` reaches first,
`src/t_c_obj.cpp:69`). Before the fence, a standing sprite with the random
start (flag 4) draws one (`sprites.md` §4). A Villager therefore draws 3
before its AI draw: start frame, fence, facing.

Loading a saved game does not re-draw: `UnitAIModule::load` reads the
stored values (`src/aiuaimod.cpp:131`, M) — unverified whether
`adjustedIdleTimeout` itself is in the save (not checked).

### 1.3 When `UnitAIModule::update` runs, and with what time

- Called at the end of `RGE_Combat_Object::update`
  (`src/com_obj.cpp:483-487`, M), only when
  `world->is_player_turn(owner id)` is true, with
  `uTime = world->get_accum_time_delta(owner id)`
  (`src/world.cpp:1365-1371`, M).
- `player_turn` rotates by one each world step over **all** players
  including Gaia (`src/world.cpp:1295-1298`, M; see `core.md` §1.2 step 7.6).
  Each step first adds `world_time_delta` to every player's accumulator
  (`src/world.cpp:1276`) and, after the players updated, zeroes the
  accumulator of the player whose turn it was (`src/world.cpp:1295`).
- Consequence for a 2-player game (`player_num = 3`: Gaia, P1, P2): each
  player's unit AIs run on every third world step, and from the fourth step
  on `uTime` is the sum of that player's last three step deltas. At the
  multiplayer default step of 90 ms and speed 1.0 that is **270 ms per AI
  update**. First steps (inferred from the code order, not run): step 1
  Gaia with `uTime = d1`, step 2 P1 with `d1 + d2`, step 3 P2 with
  `d1 + d2 + d3`, step 4 Gaia with `d2 + d3 + d4`, ...
- Everything else in a unit (actions, movement, attacks) still updates every
  step; only the AI decisions are on this 1-in-3 cadence.

### 1.4 Computer-player branches are dead in a human-vs-human game

`computerPlayer()` returns a flag set only for players created as computer
players (`src/player.cpp:284`, M; `src/tplayer.cpp:228-232`). Gaia is built
with the flag 0 (`src/tworld.cpp:229-230`, `src/tplayer.cpp:3951`). With two
humans every `computerPlayer() == 1` branch is therefore unreachable,
including: `lookAround` and its random timeout (`src/aiuaimod.cpp:576-577`,
`:2451-2474`), the distance-based priority rescale (`:485-492`),
`processMisc` re-targeting for attack orders (`:3496`), soldier kiting and
the `0x20F` evasive jump with its two `rand() % 8` draws
(`src/taiuaimd.cpp:1699-1840`), priest auto-heal/auto-convert
(`src/taiuaimd.cpp:1131-1217`), ship evasion when idle
(`src/taiuaimd.cpp:1379-1401`, `:1483-1508`, `:1618-1641`). The `0x20F`
"incoming missile" event, which the base and civilian handlers treat like
ATTACKED, is only sent to targets owned by a computer player
(`src/com_obj.cpp:226-229`). The port can
leave them out for the 2-player milestone; they come back with M5.

## 2. `UnitAIModule::update` order of operations

`src/aiuaimod.cpp:409-581`, status **L** (`INDEX.md` says M; the config
says `accepted_logic`). Steps in order:

1. If the object is dying or dead (`object_state > 2`), return
   (`:412-414`).
2. Clear the per-update flags; read whether the object has a game action
   (`:416-421`). If it has none and is flagged waiting-to-move, clear that
   flag (`:422-424`).
3. **Current target check** (`:426-494`), if a current target id is set:
   - Target object gone from the world: clear the target id; if the AI
     action is ATTACK, clear the target fully, `stopObject(1)` and set
     `idleTimer = idleTimeout` (so the idle scan comes early; §3)
     (`:429-439`).
   - Target exists but is dying (`object_state > 2`) while this unit is
     alive, and the current action needs a live target (ATTACK, DEFEND,
     HEAL, CONVERT, REPAIR, FOLLOW, or any action when
     `stopAfterTargetKilled` is set; `:1163-1172`, M):
     clear `stopAfterTargetKilled`; then
     - action ATTACK: call `processIdle(0)` immediately (the class's idle
       scan, §3–§5, **no** retryable-order step). If it found nothing
       (returns 5) and the order is not STAND_GROUND, issue
       `moveTo(stored target x, y, z, weaponRange)`. The stored position is
       where the target stood when the attack began, not where it died
       (decomp `@bug` note at `:449-451`). If that move fails, clear target
       and `stopObject(1)`; if it succeeds, move the current order to
       `lastOrder` and clear order and priority. If the idle scan found a
       new target (returns 6) and the order is not STAND_GROUND, also clear
       the order (`:444-476`).
     - any other such action: clear the target and `stopObject(1)`
       (`:477-482`).
4. **Prune attackers** (`:496-509`): if the list is empty, clear the
   object's under-attack flag. Otherwise walk the list and remove the
   **first** entry whose object is gone, has no AI, is dying, or whose
   current target is no longer this unit; at most one removal per update.
5. Store the current world position; add `uTime` to `idleTimer`,
   `secondaryTimer` and `lookAroundTimer` (`:511-516`).
6. **Notifications** (`:518-530`): process the queue in arrival order
   with the class's `processNotify`. Result 4 (this unit died): purge the
   queue and return at once (no orders, no idle). Result 3: stop handling
   further notifications this update. Then purge (empty) the queue.
7. If there is no game action, clear an AI action of ATTACK, GATHER, MOVE,
   HUNT, TRAIN or RESEARCH (`:532-543`).
8. Return if the unit died during the above (`:545-547`).
9. Group commander: `updateGroup` (`:549-551`, L; computer groups only).
10. **Order queue** (`:553-561`): only when the AI action is none. Walk the
    queue from index 0; `processOrder` (`:2543`, L) runs the order and
    **always removes it** from the queue, success or not; stop at the first
    success. Note the index is still incremented after a failed order was
    removed, so the order that slid into its place is skipped this update
    (inferred from the code shape; not observed).
11. `processMisc` (`:563`; base `:3477`, M): for human units only the
    DEFEND and FOLLOW order upkeep do anything (re-approach the guarded
    object/position, or attack the guarded object's closest attacker).
12. **Idle timer** (`:565-574`): if `idleTimer > adjustedIdleTimeout`:
    reset `idleTimer` to 0 and, only when there is no AI action **and** no
    current target, call `processIdle(1)`. Else, if there is an action or a
    target, reset `idleTimer` to 0. So the timer only accumulates while the
    unit is fully idle, and the idle scan fires on the first AI update whose
    accumulated idle time strictly exceeds the adjusted timeout.
13. `lookAround` for computer players only (`:576-578`).

## 3. Idle scan ("auto-attack when idle")

### 3.1 Per-class `processIdle`

| class | idle behaviour (human or Gaia owner) | ref, status |
| --- | --- | --- |
| base (towers, generic predators) | retryable order (never, base returns 0) then `bestUnitToAttack(1, 0)`; attack it if found | `src/aiuaimod.cpp:3464-3475`, M |
| soldier | owner Gaia: nothing. Master 299 (scout) of a human: nothing. STAND_GROUND catapults (35, 36) and id 250: nothing. Otherwise `bestUnitToAttack(1, 0)` and attack | `src/taiuaimd.cpp:1852-1900`, M |
| civilian | nothing (villagers never auto-attack when idle) | `src/taiuaimd.cpp:871-873`, M |
| priest | nothing for humans | `src/taiuaimd.cpp:1131`, M |
| building (non-tower) | nothing | `src/taiuaimd.cpp:2282`, M |
| elephant | nothing | `src/taiuaimd.cpp:227`, M |
| ships (fishing, trade, transport) | nothing for humans | `src/taiuaimd.cpp:1379`, `:1483`, `:1618`, M |
| hunted animal | flee from the closest visible important object (§5.1) | `src/taiuaimd.cpp:89-109`, M |
| lion | attack the closest visible important object within 2 × LOS (§5.3) | `src/taiuaimd.cpp:320-351`, M |
| artifact | change owner to the closest object's owner when only one player is in view (also every update via `processMisc`) | `src/taiuaimd.cpp:2128-2162`, M |

For the soldier, `processRetryableOrder` (`src/aiuaimod.cpp:3699`, M) runs
first but the soldier class never retries, so it returns "nothing" (7).

### 3.2 The visible-unit search (`search`, `GetVisibleUnits`)

`UnitAIModule::search` (`src/aiuaimod.cpp:1115-1150`, M) runs at most once
per update (guard at `:1120-1123`) and fills five global result buckets via
`Visible_Unit_Manager::GetVisibleUnits` (`src/vis_unit.cpp:195-278`, L):

- Centre: the unit's tile `(int)world_x, (int)world_y`; radius: master LOS
  truncated to int, doubled for master 118 (builder villager)
  (`:1141-1144`), clamped to 15 (`src/vis_unit.cpp:203-205`). DEFEND orders
  search around the defended object with its LOS instead (`:1127-1138`).
- Candidates: for each object group in the class's **important objects**
  list (table below), in list order, every record in the searching
  player's per-group list. A record is in player P's list only while the
  object is visible to P (`Update_Unit_Info`, `src/vis_unit.cpp:119`, L;
  called from `src/com_obj.cpp:42`, `:417`, `:448`).
- Distance: an integer "LOS-disc" distance looked up from a 16 × 16 table
  built from the fog-of-war LOS shapes `NormalLOS[0..16]`
  (`Build_Distance_Table`, `src/vis_unit.cpp:76-117`, D; shapes at
  `src/visible.cpp:11-136`). Records farther than the radius are dropped;
  each bucket holds at most 256 results (`src/vis_unit.cpp:264-266`).
- Bucket: `owner.unitDiplomacy[record owner]`: 0 Gaia, 1 self, 2 ally,
  3 neutral, 4 enemy (`include/player.h:19-23`; set in
  `RGE_Player::set_relation`, `src/player.cpp:1263-1276`, M).
- **Stale positions:** a record stores the object's tile only when it is
  added; it is not updated while the object stays visible to that player,
  because `Update_Unit_Info` runs only when the object's visibility bits
  change (`src/com_obj.cpp:438-451`, with the decomp's `@bug` note at
  `:443-446`). So both the radius filter and the distance use the tile at
  which the searcher's player **first** saw the object. A unit that walks
  past under continuous vision is searched at its old tile.

Distance table `d[dy][dx]` (|dy|, |dx| in tiles; `-` = beyond 16; derived
from `src/visible.cpp:11-136` with the `src/vis_unit.cpp:87-116` rule
"smallest radius whose shape contains the cell"):

| dy\dx | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 |
| 1 | 1 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 |
| 2 | 2 | 2 | 3 | 4 | 5 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 |
| 3 | 3 | 3 | 4 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 10 | 11 | 12 | 13 | 14 | 15 |
| 4 | 4 | 4 | 5 | 5 | 6 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 |
| 5 | 5 | 5 | 5 | 6 | 6 | 7 | 8 | 9 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 |
| 6 | 6 | 6 | 6 | 7 | 7 | 8 | 9 | 9 | 10 | 11 | 12 | 13 | 13 | 14 | 15 | 16 |
| 7 | 7 | 7 | 7 | 8 | 8 | 9 | 9 | 10 | 11 | 11 | 12 | 13 | 14 | 15 | 16 | - |
| 8 | 8 | 8 | 8 | 9 | 9 | 9 | 10 | 11 | 11 | 12 | 13 | 14 | 14 | 15 | 16 | - |
| 9 | 9 | 9 | 9 | 10 | 10 | 10 | 11 | 11 | 12 | 13 | 14 | 14 | 15 | 16 | - | - |
| 10 | 10 | 10 | 10 | 10 | 11 | 11 | 12 | 12 | 13 | 14 | 14 | 15 | 16 | 16 | - | - |
| 11 | 11 | 11 | 11 | 11 | 12 | 12 | 13 | 13 | 14 | 14 | 15 | 16 | 16 | - | - | - |
| 12 | 12 | 12 | 12 | 12 | 13 | 13 | 13 | 14 | 14 | 15 | 16 | 16 | - | - | - | - |
| 13 | 13 | 13 | 13 | 13 | 14 | 14 | 14 | 15 | 15 | 16 | 16 | - | - | - | - | - |
| 14 | 14 | 14 | 14 | 14 | 15 | 15 | 15 | 16 | 16 | - | - | - | - | - | - | - |
| 15 | 15 | 15 | 15 | 15 | 16 | 16 | 16 | - | - | - | - | - | - | - | - | - |

Before looking up, `GetVisibleUnits` first rejects records outside the
square `|dx|, |dy| <= radius` (`src/vis_unit.cpp:222-256`).

Important-object lists (object groups, in scan order; from the constructors
in `src/taiuaimd.cpp`; group names from `include/m_s_obj.h:22-55`):

| class | groups, in order | ref |
| --- | --- | --- |
| soldier, tower, building | 0, 3, 4, 26, 24, 6, 35, 25, 17, 12, 23, 36, 28, 18, 13, 27, 22, 20, 2, 21, 39 | `:1643-1670`, `:2164-2191`, `:2209-2236` |
| civilian | 3, 7, 8, 9, 10, 15, 17, 18, 32, 33, 27 | `:487-504` |
| priest | 3, 0, 4, 26, 24, 6, 25, 17, 10, 12, 35, 23, 36, 28, 18, 13, 39 | `:879-902` |
| hunted animal | 0, 4, 26, 24, 6, 25, 17, 10, 12, 35, 23, 36, 28, 18, 13, 39 | `:12-34` |
| generic predator | 29, 9, 0, 4, 26, 24, 6, 25, 17, 13, 12, 35, 23, 36, 28, 18, 39 | `:111-134` |
| lion | 29, 9, 0, 4, 26, 24, 6, 25, 17, 13, 12, 35, 23, 36, 28, 18, 39 | `:231-254` |
| elephant | none (never searches) | `:177-178` |

Group 17 is not named in `m_s_obj.h` (unverified meaning).

### 3.3 `bestUnitToAttack(allowWalls, quickCheck)` (`src/aiuaimod.cpp:1177-1418`, M)

Inputs: the search buckets, this unit's master, owner, current target.
Distances: `dist` = `distance_to_object` (float, edge to edge:
`max(0, |Δx| − rA − rB)` per axis, then the Euclidean length;
`src/stat_obj.cpp:2299-2318`, M) and `vdist` = the integer LOS-disc
distance of the record (§3.2).

1. `search()` (`:1196`).
2. Reaction limit `modifier` (`:1199-1220`): outside single-player
   difficulty tweaks it is `2 × (int)LOS` (`:1219`). Because the search
   radius is already `(int)LOS` (≤ 15) and `vdist ≤ radius`, the
   `vdist <= modifier` test never rejects anything in multiplayer.
3. `wallOK` = 1 when the current target is a wall (`:1228-1233`).
4. **Pass 1** (`:1242-1282`) over buckets 4 (enemy), 3 (neutral),
   2 (ally), each in record order. A candidate passes the filter when:
   it exists and is alive or under construction (`object_state <= 2`);
   its owner is not self or ally; it is not garrisoned (`inside_obj`);
   it is not a wall unless `allowWalls` and `wallOK`; it is not a building
   with `hp <= 1.0` when the searcher is a catapult (35, 36); the class's
   `canAttackUnit` accepts it; for bucket 3, `canAttackUnitAtNeutrality`
   accepts its group; and `minRange <= dist` and `vdist <= modifier`.
   For each passing candidate count:
   - `nUnits`: candidates whose group is not 3 (building),
   - `nArmed`: candidates with `damageCapability() > 0` (sum of the
     candidate's positive attack values; `src/com_obj.cpp:859-877`, M),
   - and track `closest` = the non-building candidate with the smallest
     `dist` (strictly smaller replaces).
5. **Current target** (`:1284-1336`): only when the AI action is ATTACK and
   `quickCheck == 0` (never true from the idle path, where the action is
   none). Its score (below, but divided by `dist` instead of `vdist`, and by
   `nUnits × dist × 0.5` when `nUnits >= 2`) becomes the starting best; a
   wonder (id 276) as current target is returned at once.
6. **Shortcut** (`:1339-1349`): if `nUnits > 1`, return `closest` provided
   it is in attack range or `canPath` to it (movement spec) succeeds.
   So with two or more enemy units in view the unit simply attacks the
   nearest one by edge distance; scoring decides only between at most one
   unit and buildings.
7. **Pass 2** (`:1351-1415`), same bucket order and filter, plus: when
   `quickCheck == 0`, skip candidates that are out of attack range and
   cannot be pathed to. If `nArmed > 0`, skip candidates whose
   `damageCapability()` is 0 (unarmed: town centres, houses, villager-less
   buildings; villagers are armed). Score:

   > `score = (B × 100 + DC × 50) / hp / vdist`, then `/ vdist³` again if `nUnits > 1`

   where `B = calc_base_damage_ability` of this unit against the candidate
   (`src/m_co_obj.cpp:525-563`, L): for each of the searcher's attacks, the
   candidate's armour of the same class (else its base armour), add
   `attack − armour` when positive; total below 1 becomes 1; truncated to
   an integer. `DC` = candidate's `damageCapability()`. The `/hp` is
   skipped when `hp <= 0` and `/vdist` when `vdist == 0`
   (constants `src/game_globals.cpp:195-201`: 100, 0.01, 0, 1, −1, 50, 0.5).
   Arithmetic is float32.
8. **Choice** (`:1397-1407`): the first passing candidate becomes best.
   Afterwards a candidate replaces the best when the best is a building and
   the candidate is not, or, when they are the same kind (both buildings or
   both non-buildings), when its score is strictly greater. A building
   never replaces a non-building. Ties keep the earlier record.
9. Returns the chosen id or −1. No random draws anywhere in this function.

`attackObject(id, 1)` (`src/aiuaimod.cpp:1752-1768`, M) then asks the
object to attack (`RGE_Combat_Object::attack`, `src/com_obj.cpp:520`, M;
no `rand()` in it or in `src/act_atak.cpp`) and on success sets the AI
action ATTACK and the current target with the target's position at that
moment. The idle path never sets an order, so auto-attacks have
`currentOrder = -1`.

## 4. Reaction to being attacked

### 4.1 How the event arrives

- `RGE_Combat_Object::damage` (`src/com_obj.cpp:292-299`, M) sends notify
  `0x1F4` ATTACKED to the victim with `p1 = attacker id`,
  `p2 = (int)hp after damage`, `p3 = max hp`. Conversion attempts send the
  same event without damage (`src/tact_cnv.cpp:292`).
- `RGE_Combat_Object::notify` (`src/com_obj.cpp:507-518`, M): if the
  victim is active and its AI accepts the event, done; otherwise forward to
  the owner (`TRIBE_Player::notify`) unless the type is `0x2BB`.
- `UnitAIModule::notify` (`src/aiuaimod.cpp:1042-1076`, M) queues the event
  (accepts) except: the object is not active (reject); `0x2BB` from a unit
  not in the attackers list (reject); TARGET_INVALID (`0x1FB`) whose `p1`
  is not the current action (reject); ACTION_COMPLETED of a MOVE while the
  AI action is not MOVE or `0x268` (accept but do not queue). The queue is
  handled at this unit's next AI update (§2 step 6): **reaction latency is
  up to three world steps**.

### 4.2 Base reaction (soldiers, towers, generic predators, priests)

`UnitAIModule::processNotify`, ATTACKED (`src/aiuaimod.cpp:2758-2934`, L):

1. `notifyCommander` (`:1083-1111`, M): forwards to a group commander (not
   used by humans) and **always** calls `owner->notify(ATTACKED, ...)`.
2. If `p2 < 1` (the hit was fatal): `owner->notify(0x209)`, purge, return 4
   (`:2762-2766`).
3. If the attackers list is empty: `owner->notify(0x201)` (the "under
   attack" alert, §6) (`:2768-2770`).
4. If the attacker is not yet in the list and is not this unit's current
   target: `askForHelp(attacker)` (§4.4) (`:2772-2784`).
5. Append the attacker to the list if absent; set under-attack
   (`:2786-2816`).
6. If the current order is anything but none or STAND_GROUND: return 2,
   ignore the attack (the unit keeps doing what the player told it).
   STAND_GROUND also returns 2 (`:2818-2824`).
7. Attacker gone, or same owner as this unit (friendly fire): return 2
   (`:2826-2833`).
8. Current action HEAL: run away (§4.5) and return 3 if that worked
   (`:2835-2837`).
9. **Has a current target** (`:2844-2913`):
   - target is a building or wall other than towers 79, 199, 69: if this
     unit can attack the attacker and it is in attack range or pathable,
     switch: `attackObject(attacker, 1)`; else run away. Return 3.
   - otherwise (target is a unit or tower): return 2 — **a human unit
     never switches from a unit target to its attacker** (the kill-time
     comparison below `:2865` is computer-only).
10. **No current target** (`:2915-2933`): if `canAttackUnit(attacker)` and
    (in attack range or pathable): `attackObject(attacker, 1)`; on success
    clear the order unless it is ATTACK; return 3. Otherwise, unless the AI
    action is MOVE, run away (§4.5); return 3.

`inAttackRange` (`src/com_obj.cpp:890-905`, M): `dist <= weaponRange +
sqrt(rx² + ry²) + 0.3` with this unit's own radii.

Soldier override (`src/taiuaimd.cpp:1688-1850`, M): only the computer
`0x20F` and post-shot kiting differ; for humans everything goes to the base.

### 4.3 Villagers (`TribeCivilianUnitAIModule::processNotify`, `src/taiuaimd.cpp:568-681`, L)

1. Fatal hit: `owner->notify(0x209)`, purge, return 4 (`:576-581`).
2. Alert `0x201` when the attackers list is empty (`:593-596`); help call
   and attacker bookkeeping as in §4.2 steps 4–5 (`:598-630`). Unlike the
   base, there is **no** `notifyCommander`, so no ATTACKED owner notify.
3. Keep working, return 2, when: order MOVE and the villager is moving;
   order ATTACK; order HUNT, currently in action state 12, hunting a
   predator, and the attacker is Gaia; order REPAIR (`:638-646`).
4. Attacker owned by Gaia (animal): fight back. If there was an order,
   re-queue it at the back of the order queue (not immediate), mark the
   order ATTACK with priority 100 and `stopAfterTargetKilled = 1`; then
   `attackObject(attacker)` (the civilian override hunts groups 9, 10, 15
   instead, `:513-525`). Return 3 (`:649-662`).
5. Attacker is a player unit: if already walking (action MOVE, speed ≠ 0)
   return 3. Otherwise re-queue the current order (back of queue),
   `stopObject(1)`, and **run away** (§4.5). Return 3 (`:664-680`).
   When the flight move completes, the action ends, the queue is processed
   (§2 step 10) and the villager resumes the re-queued order (inferred
   from the flow; not run).

### 4.4 `askForHelp` (`src/aiuaimod.cpp:2494-2541`, M)

Runs the victim's own `search()` and walks buckets 1 (self) and 2 (ally).
For each other object with an AI, alive, not in groups 1, 3, 4, 21, 18, 20,
27 (artifact, building, civilian, fishing boat, priest, transport, wall),
owned by the victim's owner or an ally, with `distance_to_object(victim) <=
3.0`, and fully idle (no AI action, no order, empty order queue): give it an
immediate ATTACK order on the attacker with priority 50. The order call
passes the attacker's `world_y` as its z (decomp argument order; harmless).
Towers (group 3) never answer. No random draws.

`order(..., immediate = 1, inFront = 0)` (`src/aiuaimod.cpp:1000-1037`,
**N**): queue at the front, clear the current target, `stopObject(1)`,
purge the notify queue, run `processOrder` on queue entry 0 right away.
Status N: the byte-level shape is unproven; the steps above are what the
source says.

### 4.5 Running away (`runAwayFromAttackers`, `evasiveMoveTo`)

`runAwayFromAttackers` (`src/aiuaimod.cpp:2205-2235`, M): sum the vectors
from this unit to every attacker still in the world, `S = (Σdx, Σdy)`;
target = position − `S / |S| × (maximumSpeed × 4.0)` (float32;
`maximumSpeed` = dat speed × sprite base speed when that is > 0,
`src/move_obj.cpp:1927-1932`, M). If `|S| = 0` the division yields NaN
(not handled in the source; behaviour of the clamp and pathing with NaN is
unverified).

`evasiveMoveTo` (`src/aiuaimod.cpp:2048-2108`, M): clamp the target into
`[0, width − 1]` × `[0, height − 1]` (only when ≥ width/height; negatives
become 0). Then up to 5 times: if `passableTile(x, y, 0)`
(`src/move_obj.cpp:1408`) stop; else jitter with **four** draws in this
order: `rand() % 2` picks + or − for x, `rand() % 4` is the x step;
`rand() % 2` for y's sign, `rand() % 4` the y step (`:2072-2082`); clamp
again. Finally `moveTo(x, y, z, 0)`; on success AI action MOVE and current
target −1 at that point. So a flight draws 0, 4, 8, ..., 20 numbers,
4 per non-passable try.

### 4.6 Other notifications (base, `src/aiuaimod.cpp:2937-3402`, L)

| event | effect for a human unit | ref |
| --- | --- | --- |
| `0x1FA` ACTION_COMPLETED, `0x1F9` ACTION_FAILED, `0x1FB` TARGET_INVALID with order ATTACK and `p1` ATTACK | `processIdle(0)`; if it found something, done; else (human) clear target and stop | `:2937-2971`, `:3017-3048`, `:3099-3130` |
| same, current order is the current action's order (`order = action + 100`) or no order and `p1` is the current action | clear target, stop (and tell the owner for 0x1F9/0x1FB) | `:2974-2990`, `:3046-3071`, `:3128-3153` |
| `0x1FC` (move-to reached its object, `src/act_move.cpp:223`) | when the target is outside full visibility (not `0x0F`) and not Gaia's: `bestUnitToAttack`, switch if different; else move to the stored target position | `:3181-3215` |
| `0x202` REQUEST_TASK while exploring | next undiscovered tile (`closestUndiscoveredTile`, one `rand() % 3` at `:1643`) | `:3230-3248` |
| `0x202` while gathering | nearest object of the same group or resource type, then gather | `:3250-3285` |
| `0x258` "attacking you" | add the caller to the attackers list | `:3321-3350` |
| `699` (`0x2BB`, stopped working on you) | remove the caller from the attackers list | `:3354-3385` |

The civilian class overrides REQUEST_TASK/TARGET_INVALID for hunt, gather
(including idle-farm handling), build and explore re-tasking
(`src/taiuaimd.cpp:707-867`, L); that belongs with the economy spec.

## 5. Animals (Gaia)

Gaia's units are updated on Gaia's AI turn (§1.3). Gaia's visibility and
diplomacy buckets (which bucket player units land in for a Gaia searcher)
were not checked: **unverified**.

### 5.1 Gazelle (hunted; also Horse 157 and Gazelle_King 384)

- Idle every ~4 s (3000..4999 ms): `closestObject(any group, any relation)`
  over its important groups (`src/aiuaimod.cpp:1506-1554`, M: smallest
  `vdist`, strictly smaller replaces; skips itself), then flee: target =
  position − unit vector to it × `maximumSpeed × 3.0`
  (`g_ai_evasive_distance_scale`, `src/game_globals.cpp:368`) via
  `evasiveMoveTo` (`src/taiuaimd.cpp:89-109`).
- Attacked: record attacker, run away from all attackers (§4.5); fatal hit
  purges and stops (`src/taiuaimd.cpp:39-87`). It never fights back.

### 5.2 Elephant (48)

Attacked: record the attacker, then `attackObject(closestAttacker, 0)`
(closest attacker by `dist`; `src/aiuaimod.cpp:1475-1502`, M); never acts
when idle (`src/taiuaimd.cpp:180-229`).

### 5.3 Lion (126)

- Idle (`src/taiuaimd.cpp:320-351`, M): first set `idleTimeout = 6000` and
  **draw a new adjusted timeout** (one `rand()`), then `closestObject` (any
  group in its list, which includes villagers, soldiers and gazelles); if
  its `dist <= 2 × LOS` (multiplayer branch, `:340-341`), attack it with
  `unconditional = 0`.
- After a kill (ACTION_COMPLETED of ATTACK): `idleTimeout = 25000` (in
  multiplayer), draw a new adjusted timeout (one `rand()`), clear target,
  stop (`src/taiuaimd.cpp:289-311`). So a lion rests 18.75..31.25 s after a
  kill, and every later idle check resets it to the 4.5..7.5 s band.
- Attacked: base reaction (§4.2); for a Gaia owner the order is normally
  none, so with no target it fights back.

### 5.4 Other predators (Alligator 1 and the "King" variants)

Base idle: `bestUnitToAttack` every 2.25..3.75 s; they consider bucket 3
units of any group (`canAttackUnitAtNeutrality` returns 1,
`src/taiuaimd.cpp:136-138`). Base reaction when attacked.

## 6. Random draws in order

All draws are `debug_rand` → the C runtime `rand()` (`core.md` §4.1). A
**fence** below means `r = rand(); ...; srand(r)`: the state after is the
15-bit `r`, whatever happened in between.

| when | draws, in order | ref |
| --- | --- | --- |
| combat object created | (start frame if flag-4 standing sprite), fence (creation sound), facing (if the sprite has facings), then 1 or 2 `rand()` for the idle timeout (§1.2) | `src/stat_obj.cpp:280-286`, `src/aiuaimod.cpp:2422`, `src/taiuaimd.cpp:36`, `:256`, `:1672`, `:1929` |
| every `TRIBE_Player::notify` call | fence at the end (`notifyAI` runs inside it, computer players only) | `src/tplayer.cpp:1776-1783`, M |
| `TRIBE_Player::notify(0x201)` when the 20 s alert cooldown is 0 and the attacker exists | one extra fence **before** the final one (alert sound and minimap ping are local) | `src/tplayer.cpp:1740-1762`, M |
| base ATTACKED handling | `notifyCommander` → 1 owner notify (fence); fatal: +1 (0x209); first attacker: +1 (0x201, possibly with its extra fence) | §4.2 |
| villager ATTACKED handling | no commander notify; fatal: 1 (0x209); first attacker: 1 (0x201) | §4.3 |
| run away | 0–20 draws in `evasiveMoveTo` | §4.5 |
| lion idle check | 1 `rand()` (new adjusted timeout) | `src/taiuaimd.cpp:321-322` |
| lion kill | 1 `rand()` | `src/taiuaimd.cpp:302` |
| explore re-task | 1 `rand() % 3` per tile search | `src/aiuaimod.cpp:1643` |
| ATTACKED forwarded straight to the owner because the AI refused it (object not active) | 1 fence | `src/com_obj.cpp:514-516` |
| computer only (dead in 2-human games) | `lookAround` timeout `rand() % 1000 + 4000`; soldier `0x20F` two `rand() % 8`; priest `rand() % (n + 2)` | `src/aiuaimod.cpp:2473`, `src/taiuaimd.cpp:1721`, `:1730`, `:1138` |

The alert cooldown `update_count` is set to 20 by an accepted 0x201 and
decremented once per game second in `TRIBE_Player::update`
(`src/tplayer.cpp:352-377`, M), per player. Gaia (`TRIBE_Gaia`) has its own
`update` (`src/tplayer.cpp:3968`), which only calls `RGE_Player::update`
(`src/player.cpp`); neither touches `update_count`. So Gaia's cooldown never
runs down: after Gaia's first accepted 0x201 it stays at 20, and every later
ATTACKED on a Gaia object skips the inner fence. The port runs the cooldown
down for players ≥ 1 only (`World.step`).

Not covered here: draws inside `moveTo`/pathing (`src/move_obj.cpp` has
`debug_rand` calls; see `movement.md`) and inside the attack itself
(`do_attack` hit roll, `src/com_obj.cpp:280-281`; combat spec).

## 7. Worked examples (test vectors)

RNG states follow `core.md` §4.1 (`state = state × 214013 + 2531011 mod
2^32`, `rand = (state >> 16) & 0x7FFF`). Computed with a scratch script
(Python, float32 via `struct`), not by running the game.

### Example 1 — clubman creation and first idle scan

A Soldier-Inf1 (id 73, class 6 → soldier AI) is created when the RNG state
is 312 at the creation fence (the standing sprite's start-frame draw, if it
has one, came before; `sprites.md` §4).

| step | value |
| --- | --- |
| creation fence: `r0 = rand()` from 312, `srand(r0)` | r0 = 1057, state 1057 |
| facing: `rf = rand()` (`src/move_obj.cpp:222`; clubman has facings, `movement.md` §9) | rf = 3490 |
| base constructor: `r1 = rand()`; adjusted = `r1 % 1500 + 2250` | r1 = 31057 → 3307 |
| soldier constructor (T = 1500): `r2 = rand()`; adjusted = `r2 % 750 + 1125` | r2 = 29299 → **1174** |

A villager (civilian, one draw) created from the same state gets
`31057 % 1500 + 2250 = 3307`; a gazelle (two draws, 3000 then 4000) gets
`29299 % 2000 + 3000 = 4299`. (An earlier version of this example left out
the facing draw; the numbers were wrong.)

With 270 ms per AI update (§1.3) and the clubman fully idle from birth, the
idle timer reads 270, 540, 810, 1080, 1350 after its 1st..5th AI
update; 1350 > 1174 first, so `processIdle(1)` runs on its **5th** AI
update (15 world steps after creation, if it was created right after its
owner's turn).

### Example 2 — idle target choice

(a) **Two units in view → nearest wins.** An idle clubman sees an enemy
villager (Man, radius 0.2) whose centre is 3.0 tiles east and an enemy
bowman (radius 0.3) 2.5 tiles north. Clubman radius 0.3.
`dist(villager) = 3.0 − 0.3 − 0.2 = 2.5`; `dist(bowman) = 2.5 − 0.3 − 0.3
= 1.9`. Both pass, `nUnits = 2 > 1`, so the shortcut returns the
**bowman** (smaller `dist`) without scoring, provided it is reachable.

(b) **Only buildings → score.** An idle bowman (id 4: one attack, class 3
amount 3) sees two enemy Watch Towers (id 79: attack class 3 amount 3,
armour class 3 amount 3, base armour 0): T1 at `vdist` 3 with 100 hp, T2 at
`vdist` 5 with 50 hp. Both armed, `nArmed = 2`, `nUnits = 0`.
`B = max(1, 3 − 3 → not added) = 1`, `DC = 3`.
Score T1 = `(1 × 100 + 3 × 50) / 100 / 3 = 0.8333333` (float32
0.8333333134651184); T2 = `250 / 50 / 5 = 1.0`. T2 wins (strictly
greater). An enemy Town Center in the same view (no attacks, `DC = 0`)
would be skipped because `nArmed > 0`.

### Example 3 — idle clubman hit by a bowman: draws and reaction

Human clubman, no order, no action, no target, attackers list empty, owner
alert cooldown 0. A bowman arrow hits it (hp 40 → 37). On the clubman's
next AI update the queued ATTACKED (`p1` = bowman, `p2` = 37) runs §4.2;
RNG state 312 at that point:

| step | RNG | state after |
| --- | --- | --- |
| `notifyCommander` → `owner->notify(0x1F4)` → final fence | `rand()` = 1057, `srand` | 1057 |
| `p2 = 37 ≥ 1`; list empty → `owner->notify(0x201)`; cooldown 0 → set 20, inner fence | `rand()` = 3490, `srand` | 3490 |
| same call, final fence | `rand()` = 11435, `srand` | 11435 |
| `askForHelp` (bowman not in list, not current target); idle own soldiers within 3.0 get ATTACK orders | none | 11435 |
| record attacker; order none; not same owner; no target → bowman in range or pathable → `attackObject(bowman, 1)`; return 3 | none in the AI (pathing: see movement spec) | 11435 |

A second hit within the next 20 game seconds costs only one fence (the
first row), because the list is no longer empty and the cooldown is not 0.

### Example 4 — villager flees a clubman

Idle human villager (Man, speed 1.1, sprite base speed assumed ≤ 0 or 1:
**unverified**) at (10.5, 10.5) hit by an enemy clubman at (12.5, 10.5).
Not a Gaia attacker, not moving → re-queue order (none: an order of −1 is
queued; harmless, `processOrder` ignores it), `stopObject(1)`, run away:
`S = (2, 0)`, `|S| = 2`, flee distance `1.1f × 4 = 4.4000001` (float32
4.400000095367432), target x = `−(2/2) × 4.4000001 + 10.5 = 6.0999999`
(float32 6.099999904632568), y = 10.5. If that tile is passable there are
no draws. If it is not, from state 312 the first jitter draws are 1057,
18886, 24299, 6319: `1057 % 2 = 1` → x += `18886 % 4 = 2` → 8.0999999;
`24299 % 2 = 1` → y += `6319 % 4 = 3` → 13.5; then test again.

## 8. Implications for the port

These are what `packages/sim` must do; they are not decomp statements.

- Give every combat object (dat type ≥ 50; groups per §1.1) an AI record
  with the timers, order queue, notify queue and attackers list, and draw
  its adjusted idle timeout(s) at creation **after** the creation fence, in
  the class's order (1 or 2 draws). The draws feed the shared stream.
- Run unit AI only on the owner's player turn (step index mod
  `player_num`), with the owner's accumulated delta. Keep Gaia in the
  rotation even if Gaia has nothing to do, or every timing shifts.
- Queue notifications and handle them on the next AI update; do not react
  inside `damage`. Reproduce the result codes (3 stops the notify loop,
  4 aborts the update).
- Implement the visible-unit index faithfully, **including** stale tile
  positions, bucket by diplomacy, important-group order, the 256 cap, the
  LOS clamp to 15 and the distance table of §3.2. Iteration order decides
  ties.
- Implement `bestUnitToAttack` exactly: two passes, the `nUnits > 1`
  nearest shortcut, unarmed skip, float32 scoring and the
  building/non-building replacement rule.
- Human players: idle soldiers and towers auto-attack, villagers and
  priests never do; units with a player order ignore attacks; units already
  attacking a unit keep their target; units attacking a non-tower building
  switch to their attacker; nearby idle military answer `askForHelp`
  within 3.0 tiles.
- Model `TRIBE_Player::notify`'s fences (including the 20 s alert
  cooldown) because each one replaces the RNG state.
- Skip the computer-player branches for the 2-player milestone (§1.4), but
  keep the `computerPlayer()` checks in the structure so M5 can enable them.
- Reproduce the known bugs: dead-target fallback moves to the frozen
  start position; the order loop skips the entry after a failed order;
  `processOrder`'s queue shift does not move the `range` field
  (`src/aiuaimod.cpp:2737-2744` copies 8 of the 9 fields: inferred effect
  is that a later order can see an earlier order's range); `askForHelp`
  passes y as z.
- Test vectors: §7 Examples 1–4, plus `core.md` §4.3 for the bare RNG.

## 9. Open points

- `UnitAIModule::update`, `processNotify` (base, civilian, building),
  `processOrder` are **L**; `order` is **N**; `GetVisibleUnits` and
  `Update_Unit_Info` are **L**. Their logic is taken as written.
- Beta vs retail: all constants here (idle timeouts, 3.0 help radius, 20 s
  alert cooldown, 4.0/3.0 flee factors) are code constants, not dat values,
  so retail differences would only show in a recording: `beta-only?` not
  ruled out.
- Gaia visibility/diplomacy buckets (§5).
- Whether any draw happens between the creation fence and `initUnitAI`
  (§1.2).
- Sprite `base_speed` for the villager walking sprite (Example 4).
