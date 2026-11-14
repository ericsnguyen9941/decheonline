# Techs and the effect engine

Source: aoe1-decomp @ `6d6d8b1` (July 1998 RoR beta; see `README.md` for the
version caveat and reference format). Status letters: M matching,
D accepted_drift, L accepted_logic, N nonmatching. Numeric types and the
float-store assumption follow `core.md` §3; the RNG is `core.md` §4.

Data values below come from the captain's retail `data2/empires.dat`
(`AOE1_DIR=/Users/erics/Downloads/AOE1`), read with `@aoe/data` `parseDat`.
In `@aoe/data` names: `Tech` (`requiredTechs`, `requiredTechCount`, `costs`,
`researchTime`, `effectId`, `locationId`), `Effect.commands[]`
(`type`, `a`, `b`, `c`, `d`), `Civ.techTreeId`, `Unit.action.workRate`,
`Unit.building.techId`.

Almost everything here is **M**. The two exceptions that matter are
`TRIBE_Player_Tech::check_for_new_tech` (**N**) and
`TRIBE_Player_Tech::tech_cost` (**N**, UI/AI cost display only), plus
`check_tech_cost`/`start_research` (**D**).

## 1. Functions and status

| function | ref | status | role |
| --- | --- | --- | --- |
| `TRIBE_Tech::TRIBE_Tech(int,…)` | `src/tech.cpp:18` | M | load tech table from dat |
| `TRIBE_Tech::do_tech` | `src/tech.cpp:133` | M | run a tech's effect |
| `TRIBE_Player_Tech` ctors | `src/tech.cpp:206`, `:235` | M | per-player state array |
| `TRIBE_Player_Tech::undo_tech` | `src/tech.cpp:258` | M | state → 0 |
| `TRIBE_Player_Tech::do_tech` | `src/tech.cpp:267` | M | complete a tech |
| `TRIBE_Player_Tech::research` | `src/tech.cpp:284` | M | add progress |
| `TRIBE_Player_Tech::tech_cost` | `src/tech.cpp:296` | **N** | displayed/AI cost |
| `TRIBE_Player_Tech::check_tech_cost` | `src/tech.cpp:374` | **D** | can afford? |
| `TRIBE_Player_Tech::start_research` | `src/tech.cpp:423` | **D** | pay, state → 2 |
| `TRIBE_Player_Tech::cancel_research` | `src/tech.cpp:455` | M | state → 1, refund opt. |
| `TRIBE_Player_Tech::check_for_new_tech` | `src/tech.cpp:476` | **N** | open/auto-complete techs |
| `TRIBE_Player_Tech::get_progress` | `src/tech.cpp:537` | M | UI percent |
| `TRIBE_Player_Tech::do_rev_tech` / `rev_tech` | `src/tech.cpp:570`, `:585` | M | start-age cascade |
| `TRIBE_Player_Tech::disable` / `enable` | `src/tech.cpp:600`, `:614` | M | state −1 ↔ 0 |
| `TRIBE_Action_Make_Tech` (all) | `src/tact_tek.cpp:14-137` | M | building research action |
| `TRIBE_Command::do_command_research` | `src/tcommand.cpp:140` | M | research command |
| `RGE_Effects::RGE_Effects(int)` | `src/effects.cpp:13` | **N** | load effects from dat |
| `RGE_Effects::do_effect` | `src/effects.cpp:153` | M | effect types 0–5 |
| `TRIBE_Effects::do_effect` | `src/teffects.cpp:11` | M | type 102, then base |
| `TRIBE_Effects::do_tech_effect` | `src/teffects.cpp:40` | M | type 102 only |
| `RGE_Player::modify_tobj{,_delta,_percent}` | `src/player.cpp:1122`, `:1159`, `:1196` | M | apply to objects |
| `RGE_Player::copy_obj` | `src/player.cpp:1233` | M | unit/building upgrade |
| `RGE_Player::new_attribute_num` / `add_attribute_num` | `src/player.cpp:843`, `:853` | M | player resources |
| `TRIBE_Player::add_attribute_num` | `src/tplayer.cpp:3661` | M | gold-earned, allied LOS |
| `RGE_Player::make_available` | `src/player.cpp:861` | M | enable unit/building |
| `TRIBE_Player::tech_abling` | `src/tplayer.cpp:1125` | M | enable/disable a tech |
| `TRIBE_Player::rev_tech` | `src/tplayer.cpp:1132` | M | scenario start age |

Status source: `config/functions/src/{tech,effects,teffects,tact_tek,player,tplayer,tcommand}.cpp.json`.
`INDEX.md` counts for these files (29/2/0/2, 3/1/0/1, 4/0/0/0, 9/0/0/0)
agree with the config.

## 2. Data

### 2.1 Tech record (`include/tech.h:130`, loader `src/tech.cpp:18-60`)

Fields used by the simulation, with their dat order: four `pre_reqs`
(short), three cost triples (`attribute` short, `attribute_cost` short,
`attribute_used` byte), `pre_reqs_required`, `build_obj_id` (the building
whose button offers it; `@aoe/data` `locationId`), two string ids,
`research` (seconds, short), `effect` (effect index, short), `track`,
`icon`, `button_location`, three help/hotkey longs, then a length-prefixed
name. Retail dat: **127 techs**.

### 2.2 Effect record (`include/effects.h:4-20`, loader `src/effects.cpp:13-56`, N)

An effect is a name and a list of 12-byte commands: `command` (byte),
`change_num1`, `change_num2`, `change_num3` (shorts) and `change_amount`
(float). `@aoe/data` maps them to `type`, `a`, `b`, `c`, `d`. Retail dat:
**218 effects**.

Loader quirk (`src/effects.cpp:25-27`): every record's 31-byte name is read
into record 0, and `save` writes record 0's name for every record
(`src/effects.cpp:133`). Consistent with this, every effect name in the
retail dat is `"A01"`. Names do not affect the simulation.

Command types present in the retail dat (count): 0:51, 1:101, 2:42, 3:61,
4:264, 5:85, 102:348. **No type 6** and no type 101 rows exist, so the
missing case 6 (§4.1) never matters with retail data.

### 2.3 Per-player state (`include/tech.h:154`)

Each player has one `{research_done: float, state: short}` per tech, all
zero at creation (calloc, `src/tech.cpp:240`). States:

| state | meaning |
| --- | --- |
| −1 | disabled (civ tech tree or scenario) |
| 0 | locked: prerequisites not met |
| 1 | available: can be researched |
| 2 | researching (paid) |
| 3 | done |

## 3. Life of a research

### 3.1 The command (`src/tcommand.cpp:140-172`, M)

`TRIBE_Command::do_command` draws one `rand()` first for every command,
research included (`src/tcommand.cpp:37`; `core.md` §4). Then
`do_command_research`:

1. Look up the building by object id; if missing, tell the player/AI the
   research was cancelled and stop (`src/tcommand.cpp:166-171`).
2. Read the building's current work via `work_status`
   (`src/t_b_obj.cpp:720`, M). Note the call passes its arguments in a
   different order from the callee's parameter names: the value tested is
   the **action type** of the current action (`src/tcommand.cpp:149-150`).
   If that is `0x66` (making a unit) or `0x67` (researching), the command
   is dropped with a cancel notice (`src/tcommand.cpp:163-165`). A building
   does one thing at a time; there is no research queue.
3. Otherwise build a `TRIBE_Action_Make_Tech` and make it the building's
   only action (`set_only_action`, `src/act_obj.cpp:353`: delete every
   current action without calling `stop`, then `add_action`).
4. `add_action` calls `first_in_stack(1)` (`src/act_list.cpp:247`), which
   calls `start_research(tech, charge=1, …)` (`src/tact_tek.cpp:53`):
   - success → action state 6 (working);
   - failure (not state 1 or cannot afford) → cancel notice, action state 1,
     removed on its first update (`src/tact_tek.cpp:59-64`, `:77-78`).

The command does **not** check that the tech belongs to this building
(`build_obj_id`) or that the player owns the building; the UI does
(unverified where; out of scope). Last, the building's unit AI gets
`setCurrentAction(RESEARCH 0x26c)` and `setCurrentTarget(unique_id, -1,
-1, -1, -1)` (`src/tcommand.cpp:156-159`), the order unchanged.

Port (`packages/sim/src/research.ts` `orderResearch`, `world.ts`
`doCommandResearch`): the `research` command `{building, tech}`. Port-side
guards as for `queue` (`economy.md` §5.5): a building the sender does not
own, one not active, an object without a production queue, or a tech id
outside the table is ignored after the per-command `rand()`. The tech's
location is not checked, as in the original.

### 3.2 Affordability (`check_tech_cost`, `src/tech.cpp:374-421`, D)

Only a tech in state 1 can pass. `carry` starts as the player's gold
(attribute 3) when attribute 29 (`PLAYER_ATTRIBUTE_GOLD_REPLACEMENT`,
`include/player.h:46`) is ≥ 1, else 0 with carry disabled
(`src/tech.cpp:380-387`). For each of the three cost slots with
`attribute ≥ 0` and `attribute_used ≠ 0`, in slot order:

1. `cost = float(attribute_cost)`.
2. If carry is enabled and the slot is gold: `carry -= cost`; if
   `carry < 0` fail with missing = 3 (`src/tech.cpp:395-402`).
3. If `have[attribute] < cost`: fail with missing = attribute when
   `carry + have < cost`; else `carry -= cost - have`
   (`src/tech.cpp:404-412`).

With carry disabled (the normal case) this is plain "every resource ≥ its
cost". Retail dat: attribute 29 starts at **0** for every civ checked
(`Civ.resources[29]`, civ 1 Egyptian); nothing in the techs examined sets
it. Treat the gold-substitution path as scenario-only (inferred).

### 3.3 Paying (`start_research`, `src/tech.cpp:423-453`, D)

If `check_tech_cost` passes and `charge` is set, for each used slot in
order: if `have < cost`, gold drops by `cost - have` and that resource
becomes 0; otherwise the resource drops by `cost`
(`src/tech.cpp:432-444`). Then `state = 2` (`src/tech.cpp:445`).
`research_done` is **not** reset here; it is still whatever it was
(0 unless a previous attempt was interrupted, see §3.6).

### 3.4 Progress (`TRIBE_Action_Make_Tech::update`, `src/tact_tek.cpp:71-109`, M)

Each world step, while the action is in state 6:

- `work = world_time_delta_seconds × work_rate` of the building's master
  object (`src/tact_tek.cpp:88`); with the `quick_build` cheat, 1000
  (`src/tact_tek.cpp:85-86`).
- `research(tech, work)` (`src/tech.cpp:284-294`): only in state 2, add
  `work` to `research_done` (float); if `!(research_done < float(research))`
  call `do_tech` and report completion.
- On completion: action state 1, notifications (UI, AI `registerResearch`,
  unit AI), and the action is removed (`src/tact_tek.cpp:92-101`).

`world_time_delta_seconds = world_time_delta × 0.001f`
(`src/world.cpp:1272`, `core.md` §1.2). Research building work rates in
the retail dat (civ 1): Academy 1, Barracks 1, Siege Workshop 1, Granary 1,
Town Center 1, Government Center 1, Market 1, Stable 1, Range 1, Storage
Pit 1, Temple 1, **Dock_1 1.5, Dock_2 2**. Work rate can be changed by
effects (attribute 13, §4.3).

### 3.5 Completion (`TRIBE_Player_Tech::do_tech`, `src/tech.cpp:267-282`, M)

Only from state 0, 1 or 2 (not −1, not 3), in this order:

1. `state = 3`.
2. `TRIBE_Tech::do_tech` (`src/tech.cpp:133-139`): if the tech's `effect ≥ 0`,
   `world->effects->do_effect(effect, player)` (§4). Effect −1 does nothing.
3. `check_for_new_tech()` (§3.7), which may complete further techs
   recursively.
4. For techs 101/102/103 (Tool/Bronze/Iron Age) add a history event 0/1/2
   (`src/tech.cpp:272-278`; statistics only).

`do_tech` does not look at cost, building or `research_done`; any caller
can complete any non-disabled tech instantly.

### 3.6 Cancelling

- **Player stop** (`TRIBE_Action_Make_Tech::stop`, `src/tact_tek.cpp:111-123`):
  `cancel_research(tech, refund=1)`: full refund of every used cost slot
  as `float(attribute_cost)` added back to that slot's own resource, even
  if part was originally paid in gold (`src/tech.cpp:461-467`);
  `state = 1`, `research_done = 0` (`src/tech.cpp:469-470`).
- **Action deleted while working** (destructor, `src/tact_tek.cpp:26-40`):
  `cancel_research(tech, refund=0)`: **no refund**, progress lost. This is
  the path when the building dies: an object past the active state deletes
  its action list (`src/act_obj.cpp:398-400`).
- `research_done` is cleared only by `cancel_research`; it survives
  `undo_tech`/`disable`.
- **Stop command on a building** (`RGE_Command::do_command_stop`,
  `src/command.cpp:262-277`, no owner check) → `TRIBE_Building_Object::stop`
  (`src/t_b_obj.cpp:1049-1054`): `RGE_Combat_Object::stop`
  (`src/com_obj.cpp:103-111`) runs `action_stop` on the top action (a
  research: the player stop above, refunded; with no action,
  `delete_list`), then the unit AI's `stopObject(1)` (`stopAction`: delete
  the now-done action, standing sprite); then
  `remove_from_production_queue(first id, 1)` until the queue is empty,
  each unit refunded. The UI shows this Stop button while the building
  researches, or trains with a queue (`src/scr_game.cpp:2759-2780`).
  Port: the `stop` command `{objects}`, buildings only (stopping units is
  not ported), the sender's own active buildings only (`economy.md` §5.5).
- **The production queue while researching**: `update_production_queue`
  removes every queue record while the building's own action is a research
  (`economy.md` §5.1 step 2) **without a refund**, the queue's train action
  stopped unpaid. A research command is accepted while units are queued
  (only an own make/research action blocks it), so queued units are lost.
  Whether the retail UI lets a player click a research with units queued
  is **unverified** (the button grid lists techs next to the queue's Stop,
  `src/scr_game.cpp:2768-2780`).

### 3.7 Opening techs (`check_for_new_tech`, `src/tech.cpp:476-527`, **N**)

One ascending pass over all techs (the `changed` loop flag is never set,
`src/tech.cpp:486-487`, so the outer loop runs once). For tech `i` in
state 0 or 1:

1. `prereq_count` and `prereq_done` over the four `pre_reqs`: a slot counts
   if its value is `≥ 0`, and is done if that tech's state is 3
   (`src/tech.cpp:496-506`). Slot value 0 means tech 0 (Dock), not "none";
   −1 is "none" (decomp note at `src/tech.cpp:497-499`).
2. If `prereq_done ≥ pre_reqs_required`:
   - if `float(research) ≤ research_done`: `do_tech(i)` at once (this is
     how zero-time "shadow" techs complete);
   - else if state < 1: `state = 1`.
3. Else, if state > 0: `state = 0` (re-lock; only reachable from state 1).

Techs in state 2 only count toward `active_count`; states −1 and 3 are
skipped. Because `do_tech` calls `check_for_new_tech` again, cascades are
depth-first recursion inside the pass, not extra passes. After the pass,
if `active_count == 0` and attribute 39 (`ALL_TECHNOLOGIES`) is exactly
0.0, it is set to 1.0 (`src/tech.cpp:523-525`; `g_tech_zero_attribute`
is 0.0, `src/game_globals.cpp:378`). The outer `active_count` is not
corrected for techs completed inside nested calls (inferred from the
structure; only matters for attribute 39).

Status **N**: the body was not byte-proven. The ordering above is the
decomp author's reading; confirm with a recording (§8).

### 3.8 Other callers that move tech state

| caller | effect | ref |
| --- | --- | --- |
| building finishes construction | `do_tech(on_build_make_tech)` if ≥ 0 | `src/t_b_obj.cpp:232`, `:292-293` |
| building captured (change owner) | same, for the new owner | `src/t_b_obj.cpp:432-433` |
| last active building of a type dies | `undo_tech(on_build_make_tech)`, then `undo_tech` 74, 75, 76 | `src/t_b_obj.cpp:314-325` |
| civ tech tree at game start | `do_effect(civ.tribe_effect)` (bonuses and type-102 disables) | `src/tworld.cpp:796-804` |
| scenario options; shared-LOS command | `tech_abling`, effect 100, `rev_tech` start age; effect 0x71 | `src/tscenaro.cpp:740-840`, `src/tcommand.cpp:428` |
| player creation (new game) | `check_for_new_tech()` | `src/tplayer.cpp:268`, `src/tech.cpp:242-244` |

`undo_tech` (`src/tech.cpp:258-265`) sets any state ≥ 1 (including 3) to
0 and re-runs `check_for_new_tech`; it **does not reverse the effect**.
Retail `on_build_make_tech` (`Unit.building.techId`, civ 1): Academy→72,
Barracks1/2→62, Dock_1/2→0, Siege_Workshop→53, Granary→10, Town_Center1/2→105,
Government_Center→33, Market1/2→26, Stable/Stable1→67, Range1→55,
Storage_Pit1/2→39, Temple1→17.

Game-start order in `TRIBE_World::new_game` (`src/tworld.cpp:394`, **D**):
optional no-trade effect 0x69 and long-combat effect 0x64 per player, then
the civ effect (or effect 0xD2 with "full tech tree"), then starting
resources by resource level (`src/tworld.cpp:782-830`). The civ effect runs
after each player's `check_for_new_tech` from creation, so techs the civ
disables may already be in state 1; `disable` sets every non-done state to
−1 regardless (`src/tech.cpp:600-612`).

## 4. Effect engine

### 4.1 Dispatch

`TRIBE_Effects::do_effect(e, player)` (`src/teffects.cpp:11-38`, M):

1. Return if `e ≥ effect_num` (no lower-bound check; a negative id reads
   out of bounds, decomp note `src/tworld.cpp:793-795`).
2. **Pass 1**, list order: type 102 → `tech_abling(int(amount), 0)`, i.e.
   **disable** tech `int(d)`; type 101 → nothing.
3. **Pass 2**, `RGE_Effects::do_effect` (`src/effects.cpp:153-208`, M), list
   order, types 0–5 below; any other type (6, 101, 102, …) is ignored
   silently (decomp note `src/effects.cpp:159-161`).

So all disables in an effect happen before any of its other commands,
whatever their order in the list.

`do_tech_effect` (`src/teffects.cpp:40-58`) runs pass 1 only; it is used
when loading a scenario/saved player (`src/tplayer.cpp:472-477`).

| type | name | operands | action |
| --- | --- | --- | --- |
| 0 | set | `a` unit id or −1, `b` class or −1, `c` attribute, `d` value | `modify_tobj` |
| 1 | resource | `a` attribute, `b` mode, `d` amount | `b == 0`: set; else add (`a ≥ 0` only) |
| 2 | enable unit | `a` unit id, `b` on/off | master `available = b` (`a ≥ 0` only) |
| 3 | upgrade | `a` dest unit id, `b` source unit id | `copy_obj(a, b)` |
| 4 | add | as type 0 | `modify_tobj_delta` |
| 5 | multiply | as type 0 | `modify_tobj_percent` |
| 102 | disable tech | `d` tech id | `tech_abling(d, 0)` (pass 1) |

`c` is passed as an unsigned byte (`src/effects.cpp:164-180`), so `c = −1`
becomes 255, which no `modify` handles: a no-op. The retail dat has one
such row each for types 4 and 5.

### 4.2 Targeting (`src/player.cpp:1122-1231`, M)

For types 0/4/5:

- `a ≥ 0`: if the player has master object `a`, apply to every one of the
  player's objects whose master is that master (object-list order), **then**
  to the master itself.
- else if `b ≥ 0`: for each master index ascending whose `object_group`
  (unit class) equals `b`: all its objects, then the master.
- both −1: nothing.

Masters are per player, so effects change only that player's units.
Objects store a pointer to their player's master, so every master-level
change applies at once to all existing and future objects of that type.
Instance-level code runs **before** the master changes, so it sees the old
master values (§4.4).

Type 1 goes through the virtual `add_attribute_num`; the TRIBE override
(`src/tplayer.cpp:3661-3670`) also bumps attribute 49 for earned gold (the
effect passes `earned = 0`, so never here) and turns on allied LOS when the
attribute is 50. Type 1 set uses `new_attribute_num` (non-virtual,
`src/player.cpp:843-851`). Both ignore attribute ids out of range.

### 4.3 Master attribute codes (`c`)

Set = type 0, add = type 4, mul = type 5. "trunc" is C float→integer
truncation toward zero, then narrowing to the field type.

| `c` | field | set | add | mul | ref |
| --- | --- | --- | --- | --- | --- |
| 0 | hit points (short) | `trunc(d)` | `+= trunc(d)` | `trunc(hp·d)` | `src/m_s_obj.cpp:643-710` |
| 1 | line of sight (float) | `d` | `+ d` | `· d` | same |
| 2 | `obj_max` (byte) | `trunc(d)` | `+= trunc(d)` | `trunc(v·d)` | same |
| 3, 4 | radius x, y (float) | `d` | `+ d` | `· d` | same |
| 5 | speed (float) | `d` | `+ d` | `· d` | `src/m_an_obj.cpp:74-96` |
| 6 | turn speed (float) | `d` | `+ d` | `· d` | `src/m_mo_obj.cpp:156-178`, `src/m_co_obj.cpp:426-428`, `:459-461` |
| 8 | armour entry | see below | see below | nothing | `src/m_co_obj.cpp:340-485` |
| 9 | attack entry | see below | see below | nothing | same |
| 10 | reload time `speed_of_attack` (float) | `d` | `+ d` | `· d` | same |
| 11 | `base_hit_chance` (short) | `trunc(d)` | `+= trunc(d)` | `trunc(v·d)` | same |
| 12 | range (float) | `d` | `+ d` | `· d` | same |
| 13 | work rate (float) | `d` | `+ d` | `· d` | `src/m_ac_obj.cpp:208-230` |
| 14 | `attribute_max_amount` carry capacity (short) | `trunc(d)` | `+= trunc(d)` | `trunc(v·d)` | `src/m_s_obj.cpp:660`, `:683`, `:706` |
| 15 | `base_armor` (byte) | `trunc(d)` | `+= trunc(d)` | `trunc(missile_id·d)` (bug) | `src/m_co_obj.cpp:373`, `:438`, `:471-473` |
| 16 | projectile unit id | `byte(trunc(d))` | `+= trunc(d)` | `trunc(v·d)` | same |
| 17 | building facet | `trunc(d)` | `+= trunc(d)` | nothing | `src/tm_b_obj.cpp:142-160` |
| 18 | `defense_terrain_bonus` | `trunc(d)` | `trunc(d)` (set!) | `trunc(d)` (set!) | `src/m_co_obj.cpp:379`, `:444`, `:478` |
| 19 | projectile `targetting_type` | byte(d) for all three ops, then falls through to combat | | | `src/m_mi_obj.cpp:110-128` |
| 100 | cost amounts (`build_inventory` slots with flag set) | `trunc(d)` | `+= trunc(d)` | `trunc(v·d)` | `src/tm_co_ob.cpp:174-271` |
| 101 | population/cost oddity | see note | default | default | `src/tm_co_ob.cpp:191-240`, `src/t_c_obj.cpp:158-176` |

Armour/attack entries (`c` 8, 9): `d` is decoded as `n = int(d)`,
`class = (n >> 8) & 0xFF`, `value = n & 0xFF`.
- Set (`src/m_co_obj.cpp:342-363`): uses `class` as an **array index**
  (not a class match) and writes `value` if the index is in range.
- Add (`src/m_co_obj.cpp:394-425`): finds the first entry whose class equals
  `class` and adds `value`; if no entry has that class, nothing happens
  (decomp note at `src/m_co_obj.cpp:389-391`).
- Because `value` is the low byte, an add can only be 0..255; negative
  adds are impossible through this encoding.

Code 101 (`'e'`) in the TRIBE master sets non-flagged cost slots to
`−d` and the held "population headroom/population/units" amounts; the
instance side adjusts the owner's attributes 4, 11 and 19. The retail dat
uses set-101 twice and set-100 once (inferred to be Rise of Rome
population/cost tweaks; not traced further).

Codes 7 and anything not listed: ignored.

Codes used by the retail dat (type:code → rows): set 0:2, 1:1, 5:3, 9:2,
10:13, 12:2, 13:2, 17:14, 19:9, 100:1, 101:2; add 0:4, 1:68, 5:12, 8:43,
9:50, 12:55, 13:19, 14:11, 15:1; mul 0:40, 5:3, 13:1, 100:40.

### 4.4 Instance attribute codes (existing objects)

Only these codes touch the object itself; every other code changes only
the master. `max` below is the **old** master value.

| `c` | set (type 0) | add (type 4) | mul (type 5) | ref |
| --- | --- | --- | --- | --- |
| 0 hp | `hp = trunc(d·hp / max)` | `hp = trunc((d + max)·hp / max)` | `hp = trunc(d·hp)` | `src/stat_obj.cpp:1724-1776` |
| 1 LOS | re-explore with radius `int(d)` | radius `int(max_los + d)` | radius `int(max_los·d)` | same |
| 17 facet (buildings) | `facet = byte(d)` | — | — | `src/t_b_obj.cpp:447-453` |
| 101 (TRIBE combat) | owner attributes 4/11/19 adjusted | — | — | `src/t_c_obj.cpp:158-176` |

LOS re-exploring runs only for objects on the map in the active state.
Instance hp is a float but the result is truncated to an integer and
stored back as float. These functions are M.

### 4.5 Upgrades (type 3, `copy_obj`, `src/player.cpp:1233-1249`, M)

If both masters exist: every object of master `dest` runs the instance
`copy_obj(source)` (object-list order), then master `dest` copies
`source`.

Instance (`RGE_Static_Object::copy_obj`, `src/stat_obj.cpp:1806-1841`, M;
plus moving/action/combat/building layers `src/move_obj.cpp:2074`,
`src/act_obj.cpp:431`, `src/com_obj.cpp:492`, `src/t_b_obj.cpp:757`):

1. If active on the map, re-explore with the source LOS.
2. `ratio = hp / old_max_hp`; set hp to the old max; if active,
   `check_damage_sprites()`.
3. Pick the matching sprite (normal/dying/undead; moving: walk/run;
   combat: fight; building: construction) of the source.
4. `hp = float(source_max_hp) × ratio`, with the master pointer briefly
   switched to the source; if active, `check_damage_sprites()` again;
   switch back; apply the new sprite.
5. The action list copies the source tasks (`src/act_list.cpp:384`).
6. Buildings with `building_connect_flag` reconnect walls
   (`src/t_b_obj.cpp:763-765`).

Hp is **not** truncated in an upgrade: the ratio is kept exactly in float.

Master (`RGE_Master_Static_Object::copy_obj`, `src/m_s_obj.cpp:518`, M, and
subclass layers): copies every field from the source except it keeps its
own `id` and `available` flag (`src/m_s_obj.cpp:519-522`, `:639-640`); it
keeps its `copy_id` only if the source is hidden in the editor, and marks
the **source** master `hide_in_scenario_editor = 1`
(`src/m_s_obj.cpp:616-620`). The name pointer is shared with the source.

So an upgrade is "this slot now has the stats of that slot"; any effect
already applied to `dest` is overwritten, and later effects aimed at the
source id no longer reach `dest`. Upgrades also wipe civ bonuses applied
earlier to the destination unless the source already had them (decomp
note at `src/tscenaro.cpp:828-830`).

### 4.6 Tech enable/disable (type 102 and scenario)

`tech_abling(id, flag)` (`src/tplayer.cpp:1125-1130`) calls `enable`
(state −1 → 0) or `disable` (any state except 3 → −1); id < 0 means all
techs (`src/tech.cpp:600-626`). Neither runs `check_for_new_tech`; a
re-enabled tech stays 0 until the next check.

## 5. RNG calls, in order

The tech and effect code itself calls `rand()` **nowhere** (no `rand`/
`debug_rand` in `src/tech.cpp`, `src/effects.cpp`, `src/teffects.cpp`,
`src/tact_tek.cpp`, `src/player.cpp`, `src/m_s_obj.cpp`, `src/m_co_obj.cpp`,
`src/tm_co_ob.cpp`; grep at `6d6d8b1`). The draws around it are:

1. Research command: one `rand()` at the top of `TRIBE_Command::do_command`
   (`src/tcommand.cpp:37`), before the building lookup, whether or not the
   command is accepted.
2. Type 3 upgrade of an **active** object: up to two `check_damage_sprites`
   calls (§4.5 steps 2 and 4). Each one that newly selects a damage sprite
   with flag 1 (randomly placed overlay) draws **three** `rand()`: the new overlay sprite's start frame
   (flag-4 sprite, `sprites.md` §4), then x and y
   (`src/stat_obj.cpp:1286`, `:1293`; `sprites.md` §6). `check_damage_sprites`
   is **L**. Buildings, every boat and heroes 236/297/377 have damage
   sprites (`sprites.md` §6); a damaged House upgraded by Tool Age can draw. `combat.md` does not cover
   `check_damage_sprites` yet (follow-up).
3. Instance `modify` (codes 0/1) does not call `check_damage_sprites`
   (`src/stat_obj.cpp:1724-1776`), so hp effects draw nothing even if the
   damage ratio changes.
4. `make_new_obj` from `on_build_make_obj` on capture
   (`src/t_b_obj.cpp:426-431`) creates an object: object creation runs
   `rand()` then `srand(r)` (economy/combat specs). Not part of the tech
   path proper.

## 6. Timing in simulation steps

- A research command executes in `do_commands` at the start of step N
  (`core.md` §1.2 step 7.1). Payment and state 2 happen then.
- The building's update later **in the same step N** adds the first work
  (`RGE_Action_Object::update` reaches the action list at
  `src/act_obj.cpp:415`; players update after commands,
  `src/world.cpp:1270-1280`). So progress starts in the command's own step.
- Completion happens inside the owning player's update of the step where
  the sum first reaches `research`; effects apply immediately, mid-update:
  objects updated later in that step (same player later in its list, and
  all higher-index players) already see the new stats; earlier ones see
  them next step.
- Steps to finish = the smallest `n` with `fround`-accumulated
  `n × work ≥ research`, where every step adds the same float `work` when
  the step length is constant. Float accumulation can cost an extra step
  (examples below).
- Techs with `research = 0` whose prerequisites are met complete inside
  `check_for_new_tech` with no time passing.

## 7. Worked examples (test vectors)

All numbers computed in float32 (`Math.fround` at every store) by a scratch
script; `0.001f = 0.0010000000474974513`.

### 7.1 Research timing: Leather Armor – Soldiers and Tool Age

Leather Armor – Soldiers (tech 40): prereqs `[39, 101]`, required 2;
cost 75 food (slot 0, type 0); `research = 30`; location 103 (Storage
Pit, work rate 1.0); effect 40.

- `world_time_delta = 100` ms each step: `delta_s = 0.1f =
  0.10000000149011612`, `work = 0.10000000149011612`. After 300 adds,
  `research_done = 30.000078201293945 ≥ 30` → done on the **300th** step
  counting step N as 1 (30 000 ms).
- `world_time_delta = 50`: 601 steps (sum 30.049827575683594).
- `world_time_delta = 150`: 201 steps (sum 30.149948120117188).
- Tool Age (tech 101, 120 s, Town Center rate 1.0) at 100 ms: **1201**
  steps (sum 120.09873962402344), not 1200: float drift.
- Wood Working (60 s) at 100 ms: 601 steps; Gold Mining (50 s): 501.
- Tool Working (tech 46, 40 s) researched at a rate-1.5 building (only a
  Dock has that; illustrative): `work = 0.15000000596046448`, 267 steps.

**Vector R1, 90 ms steps** (the port's `STEP_MS`): `delta_s = work =
fround(90 × 0.001f) = 0.09000000357627869` at a rate-1 building.

| tech | research | steps | sum at completion |
| --- | --- | --- | --- |
| 10 / 39 / 62 (Granary / Storage Pit / Barracks built), free | 2 | 23 | 2.070000410079956 |
| Leather Armor – Soldiers (40) | 30 | 334 | 30.060041427612305 |
| Tool Age (101) | 120 | 1334 | 120.05781555175781 |
| Bronze Age (102) | 140 | 1556 | 140.03700256347656 |
| Iron Age (103) | 160 | 1778 | 160.0161895751953 |

The command's step counts as step 1 (§6): a Tool Age ordered by a command
that runs on step N is done during the update of step N + 1333, its 500
food paid in step N before any work. `research_done` keeps the sum after
completion. Tests: `packages/sim/src/research.test.ts` "techs.md §7.1
vector R1" (every row above, the 100 ms Tool Age row, and the command
path).

### 7.2 Cost and refund

Iron Age (tech 103): costs 1000 food (slot 0) and 800 gold (slot 1).
Attribute 29 = 0 (carry off).

- Player food 1200, gold 700: slot 0 passes (1200 ≥ 1000); slot 1 fails,
  700 < 800 and carry 0 → command accepted but `start_research` fails,
  missing attribute 3, nothing paid, action removed on its first update.
- Player food 1200, gold 900: pass; afterwards food 200, gold 100,
  state 2. Stop → refund to food 1200, gold 900, `research_done = 0`,
  state 1. Town Center destroyed instead → food 200, gold 100, state 1.

Bronze Shield (tech 47): 150 food + 180 gold, scenario with attribute
29 = 1, player food 100, gold 300:
- check: carry = 300; food slot: 100 < 150 and 300 + 100 ≥ 150 →
  carry = 250; gold slot: carry = 250 − 180 = 70 ≥ 0, and 300 ≥ 180 → pass.
- pay: food 100 < 150 → gold = 300 − 50 = 250, food = 0; gold 250 ≥ 180
  → gold = 70. Result food 0, gold 70.
- stop refund: food 150, gold 250 (each slot refunded in its own resource).

### 7.3 Effects on existing objects

**Leather Armor – Soldiers**, effect 40 (retail):
`{1, a 21, b 1, d 1}`, `{4, a −1, b 6, c 8, d 1026}`,
`{4, a −1, b 28, c 8, d 1026}`. `1026 = 0x402` → armour class 4 (melee),
+2. For every master of class 6 (infantry) and 28: find the armour entry
with class 4 and add 2. Clubman (unit 73, class 6) armours
`[{9,−5},{4,0},{3,0}]` → `[{9,−5},{4,2},{3,0}]`; Phalanx (93, class 28)
`[{4,5},{3,0}]` → `[{4,7},{3,0}]`. Attribute 21 (technology count) +1.
Existing clubmen change at once (shared master); no instance code runs
for code 8.

**Tool Working**, effect 46 includes `{4, a −1, b 24, c 9, d 1024}`:
`1024 = 0x400` → attack class 4, +0: a no-op row in retail data.

**Architecture**, effect 111: `{5, a 118, c 13, d 1.5}` (work rate × 1.5
for unit 118), `{5, b 3, c 0, d 1.2000000476837158}` and the same for
class 27 (hp × 1.2), and `{5, a −1, b −1, c −1, d 0}` (no-op). For a
House (unit 70, class 3, max hp 75) with current hp 37.5:
- instance first: `hp = trunc(1.2f × 37.5) = trunc(45.0000017…) = 45`;
- then master: `hp = trunc(75 × 1.2f) = trunc(90.0000036) = 90`.
  The House now shows 45/90 (ratio 0.5 kept). With current hp 62:
  `trunc(74.4000015) = 74` → 74/90 (ratio not kept exactly).
- A Town Center (600) at full hp: 720/720.

**Add hp** (type 4, `c 0`), illustrative `d = 15` on a unit with max 40:
current 27 → `trunc((15 + 40) × 27 / 40) = trunc(37.125) = 37`; current
40 → 55; current 1 → `trunc(1.375) = 1`. Master 40 → 55.

### 7.4 Game start and Tool Age prerequisites

At player creation `check_for_new_tech` runs once (ascending ids):
- Tech 29 is an all-zero row: `pre_reqs = [0,0,0,0]`, required 0,
  research 0, effect 0. `0 ≥ 0` passes and `0 ≤ research_done = 0`, so it
  completes immediately and runs effect 0 (retail: enable units 13 and
  15). The decomp note at `src/tech.cpp:497-499` says such a row opens
  "once research 0 is done"; with required = 0 the code as read opens it
  at once (inferred, rests on the **N** body).
- Tech 100 (Stone Age): no prereqs, required 0, research 0, effect 94
  (age attribute 6 = 1, town-center facet 1, enable units 83 and 70,
  attribute 30 += 8) → completes immediately.
- Tech 101 (Tool Age): prereqs `[74, 100]`, required 2 → stays 0 until
  tech 74 is done.
- Tech 74 (shadow): prereqs `[0, 10, 39, 62]` = Dock, Granary, Storage
  Pit, Barracks built; required 2; research 0; effect −1. Building any two
  completes 74 the moment the second is finished (`on_build_make_tech` →
  `do_tech` → `check_for_new_tech`), which opens 101 (state 1).
- If all buildings of such a type die, `undo_tech` sets their tech and 74
  back to 0 (§3.8); Tool Age, if not yet researched, re-locks on the next
  check. Effects already applied stay.

### 7.5 Vector R2: the Tool Age through commands

Egyptian player 1 on the test map (`startingObjects(3)`), food and wood
set to 2000: its Villagers build a House, a Granary and a Barracks. The
finished Granary and Barracks complete techs 10 and 62 (`on_build_make_tech`),
which complete shadow tech 74 (2 of 0/10/39/62); the Tool Age (101,
prerequisites 74 and 100) becomes state 1. The `research` command at the
Town Center pays 500 food; 1334 steps later (R1) the Tool Age is done:

- effect 95: attribute 6 (age) = 2; Town Center (109) facet = 2; House
  (70) ← House1 (154) by `copy_obj` (id and `enabled` kept; the built
  House instance swaps to House1's standing sprite 234); attribute 21
  (technology count) +1; attribute 30 (building allowance) +8; Scout (299)
  line of sight +2;
- `check_for_new_tech` then completes the zero-time techs it opens:
  94 (101 + Granary built 10, effect 77: enable Market 84), 95 (101 +
  Barracks built 62, effect 75: enable Archery Range 87), 97 (101 + 62,
  effect 79: enable Stable 101), 123 (101, effect 201: enable Slinger
  347); techs 11 (Stone Wall, effect 11: enable wall 72) and 16 (Watch
  Tower, effect 12: enable 79), 50 food and 10 s at the Granary, open
  (state 1); the Bronze Age (102) stays 0 until tech 75 (2 of Market 26,
  Range 55, Stable 67 built);
- the Villagers build an Archery Range (87); when it is finished its tech
  55 (2 s, free, no prerequisite, so state 1 from the start) is done by
  `on_build_make_tech`, and effect 55 enables the Bowman (4); a `queue`
  of one Bowman at the Range trains it.

Player 2 (no commands) keeps its masters, tech states and attributes
exactly as at game start: effects change only the researching player's
masters. Test: `research.test.ts` "techs.md §7.5 vector R2".

## 8. Unverified / inferred points

- `check_for_new_tech` is **N**: the single-pass order, recursion and the
  attribute-39 rule are the decomp author's reading.
- x87 extended intermediates: products like `delta × 0.001f` and
  `delta_s × work_rate` are assumed to round to float on store, giving
  the `fround` results in §7 (`core.md` §3 assumption). Not proven for
  this exact code path.
- Gold substitution (attribute 29) being scenario-only is inferred from
  the retail civ start values; not traced to every setter.
- Instance code for codes 0/1 being the only per-object handlers rests on
  a grep for `::modify` overrides at `6d6d8b1` (stat_obj, t_c_obj, t_b_obj).
- Type-101 cost/population code (§4.3) not traced to gameplay.
- (Resolved: boats and heroes 236/297/377 do have flag-1 damage sprites,
  `sprites.md` §6; §5 item 2 corrected.)
- All of this is beta code; retail 1.0a logic assumed equal (`beta-only?`
  where it would matter: none found).

## 9. Implications for the port

- **Data model:** keep per-player copies of every master (unit type) and
  let objects reference the master; master-level effects must reach live
  objects without iterating them. Port: `World.masters[player][id]`
  (`packages/sim/src/masters.ts`), copies of the player's civ's records
  (`civUnitTypes`, generated per civ in `unit-data.ts` `CIV_RECORDS`);
  every object reads its owner's copy (`typeOf`); the civ effect runs at
  game start after the starting objects (§3.8). The world hashes each
  player's masters once per change (`mastersChanged`, called by
  `doEffect`). Per player keep `{researchDone: f32,
  state: i16}` per tech.
- **Order:** within one effect, apply every type-102 row first, then
  rows 0–5 in list order. Within a row: instances (in the player's
  object-list order) before the master. Ignore type 6 and unknown `c`
  codes silently; `c = −1` is a no-op.
- **Float rules:** accumulate `researchDone` in float32 with a store per
  step; compare `!(done < research)`. Truncate (toward zero) wherever §4.3
  says trunc; keep the upgrade hp ratio in float without truncation.
- **Armour/attack add** matches by class and cannot create entries or
  subtract; **set** indexes the array by "class". Reproduce both quirks.
- **`c 15` multiply reads `missile_id`**, `c 18` add/multiply set: keep
  them only if a retail dat row uses them (retail: add-15 once, no mul-15,
  no 18), but implementing the quirk costs nothing.
- **Research lifecycle:** one action per building, reject a research
  command while the building trains or researches; pay in
  `first_in_stack` at command time; progress from the same step; refund
  only on player stop; lose everything when the building dies.
- **`check_for_new_tech`** must run after every completion, `undo_tech`,
  and at player creation, as a single ascending pass with recursive
  completions; zero-time techs complete inside it.
- **RNG:** the tech path itself draws nothing; keep the one draw per
  command (core) and the damage-sprite draws in upgrades of active
  buildings (§5; `check_damage_sprites` still needs its own spec).
- **Golden tests:** use §7 numbers as unit vectors (research step counts,
  cost/refund, armour packing, hp scaling); confirm §3.7 and the
  damage-sprite draws with a retail recording.
