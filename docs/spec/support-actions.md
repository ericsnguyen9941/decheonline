# Support actions: convert, heal, repair, trade

Source: aoe1-decomp @ `6d6d8b1` (July 1998 RoR beta; see `README.md` for the
version caveat and reference format). Status letters: M matching,
D accepted_drift, L accepted_logic, N nonmatching. Float handling follows
`core.md` §3, the RNG `core.md` §4, sim step timing `core.md` §1.2 and §2.2.
Movement sub-actions (`RGE_Action_Move_To`) are `movement.md` §5.

Two of the eight per-step state machines here are not byte-proven:
`TRIBE_Action_Repair::update` is **N** and `TRIBE_Action_Trade::update` is
**L**. Everything else in the four action files is M.

## 1. Functions and status

| function | ref | status | role |
| --- | --- | --- | --- |
| `TRIBE_Action_Convert` ctors | `src/tact_cnv.cpp:22`, `:29`, `:42` | M | `requiredRange` default 1.0 |
| `TRIBE_Action_Convert::first_in_stack` | `src/tact_cnv.cpp:58` | M | refusals, range |
| `TRIBE_Action_Convert::set_state` | `src/tact_cnv.cpp:133` | M | state entry effects |
| `TRIBE_Action_Convert::update` | `src/tact_cnv.cpp:204` | M | per-step machine, the roll |
| `TRIBE_Action_Convert::work` | `src/tact_cnv.cpp:349` | M | retarget |
| `TRIBE_Action_Convert::martyrdom` | `src/tact_cnv.cpp:366` | M | instant conversion on death |
| `TRIBE_Action_Heal::first_in_stack` | `src/tact_hea.cpp:46` | M | boat filter |
| `TRIBE_Action_Heal::set_state` | `src/tact_hea.cpp:59` | M | |
| `TRIBE_Action_Heal::update` | `src/tact_hea.cpp:117` | M | per-step heal |
| `TRIBE_Action_Repair::first_in_stack` | `src/tact_rep.cpp:68` | M | |
| `TRIBE_Action_Repair::set_state` | `src/tact_rep.cpp:76` | M | |
| `TRIBE_Action_Repair::update` | `src/tact_rep.cpp:167` | **N** | per-step repair |
| `TRIBE_Action_Repair::work`, `move_to`, `meet_target` | `src/tact_rep.cpp:330`, `:321`, `:354` | M | retarget, boat rendezvous |
| `TRIBE_Action_Trade::first_in_stack` | `src/tact_trd.cpp:55` | M | default cargo = wood |
| `TRIBE_Action_Trade::set_state` | `src/tact_trd.cpp:71` | M | |
| `TRIBE_Action_Trade::update` | `src/tact_trd.cpp:186` | **L** | load, deliver, gold formula |
| `TRIBE_Action_Trade::work`, `move_to` | `src/tact_trd.cpp:470`, `:447` | M | |
| `TRIBE_Command::do_command_trade_attribute` | `src/tcommand.cpp:489` | M | cargo choice (§7.6) |
| `TribeTradeShipUnitAIModule::processNotify` | `src/taiuaimd.cpp:1232` | M | §7.5 |
| `TRIBE_Combat_Object::update` | `src/t_c_obj.cpp:146` | M | faith recharge |
| `TRIBE_Combat_Object::die_die_die` | `src/t_c_obj.cpp:202` | M | martyrdom trigger |
| `TRIBE_Combat_Object::change_ownership` | `src/t_c_obj.cpp:240` | M | conversion result |
| `TRIBE_Combat_Object::convert` / `heal` / `repair` | `src/t_c_obj.cpp:525`, `:552`, `:579` | M | order → action |
| `TRIBE_Combat_Object::heal(float)` | `src/t_c_obj.cpp:982` | M | boats: scaled, paid |
| `TRIBE_Combat_Object::do_repair` | `src/t_c_obj.cpp:1007` | M | repair task pick |
| `TRIBE_Building_Object::heal(float)` | `src/t_b_obj.cpp:215` | M | buildings: scaled, paid |
| `RGE_Static_Object::heal(float)` | `src/stat_obj.cpp:2224` | M | add hp, clamp |
| `TRIBE_Player::check_obj_cost` / `pay_obj_cost` | `src/tplayer.cpp:1031`, `:1080` | M / M | repair cost |
| `TRIBE_Player::update` | `src/tplayer.cpp:352` | M | trade-goods regrowth |
| `RGE_Player::isAlly` | `src/player.cpp:296` | M | self or allied, never Gaia |

Status source: `config/functions/src/{tact_cnv,tact_hea,tact_rep,tact_trd,t_c_obj,t_b_obj,stat_obj,tplayer}.cpp.json`
in the clone (note the `.cpp.json` suffix; `README.md` says `<file>.json`).

## 2. Inputs from `empires.dat`

Field names are the decomp's; the `@aoe/data` name is in brackets. Values are
from the captain's `data2/empires.dat` (`VER 3.7`, 17 civs), civ 1
(Egyptian) unless noted, read with `parseDat` from `@aoe/data`.

| quantity | field | read at | used for |
| --- | --- | --- | --- |
| task `work_val1` (float) [`workValue1`] | task record | `src/task.cpp:86` | convert: success threshold; heal, repair: rate |
| task `work_val2` (float) [`workValue2`] | task record | `src/task.cpp:87` | convert: seconds per attempt |
| task `work_range` (float) [`workRange`] | task record | `src/task.cpp:88` | heal: leash distance; trade: approach range |
| `work_rate` (float) [`action.workRate`] | master action object | `src/m_ac_obj.cpp:61` | multiplies the above |
| `weapon_range` (float) [`combat.maxRange`] | master combat object | `src/m_co_obj.cpp:109` | convert and repair approach range |
| `hp` (short) [`hitPoints`] | master static object | `core.md` §3 | heal clamp, repair scaling |
| `build_pts_required` (short) [`creatable.trainTime`] | master combat object | `src/tm_co_ob.cpp:64` | repair scaling |
| `build_inventory[3]` [`creatable.costs`] | master combat object | (cost table) | repair cost |
| `attribute_max_amount` (short) [`resourceCapacity`] | master static object | `src/m_s_obj.cpp:188` | trade cargo size |
| `drop_site` [`action.dropSites[0]`] | master action object | (not re-read) | trade home dock |
| civ attribute start values [`civ.resources[i]`] | civ record | (civ table) | §2.2 |

### 2.1 Unit values (real data)

| unit (id) | class | hp | `work_rate` | `weapon_range` | other |
| --- | --- | --- | --- | --- | --- |
| Priest (125) | 18 | 25 | 1 | 10 | tasks: heal `0x69` wv1 3, wr 0; convert `0x68` wv1 0.3 (float 0.30000001), wv2 3, wr 0 |
| Hero priests 81, 228, 245 | 18 | 150 / 25 / 180 | 1 | 12 / 2 / 12 | convert 0.3 / 3; heal wv1 10 |
| Repair_Man (156) | 4 | 25 | 0.4 (float 0.40000001) | 0 | repair `0x6A`: class −1 wv1 0.75; classes 21, 2, 20, 22 (boats) wv1 5 |
| Boat-Trade1 (15) / Boat-Trade2 (16) | 2 | 200 / 250 | 3 | 0 | capacity 20; drop site 45; trade `0x6F` vs unit 45, wv1 50 / 100 (unused by the code), wr 0; trainTime 50; cost 100 wood |
| Dock_1 (45) | 3 | 350 | | | |
| Town_Center1 (109) | 3 | 600 | | | trainTime 60; cost 200 wood, plus attribute 30 × 1 with flag 0 |
| Barracks1 (12) | 3 | 350 | | | trainTime 30; cost 125 wood |

### 2.2 Player attributes (real data and techs)

| attribute | id | start (all 16 civs) | changed by (effect command, real data) |
| --- | --- | --- | --- |
| trade goods | 9 | 0 | consumed by trade; +attr 10 per second, cap 100 (§6.4) |
| trade production | 10 | 1 | |
| priest conversion allowed | 27 | 0 | Monotheism (tech 19): set 1 |
| building conversion allowed | 28 | 0 | Monotheism (tech 19): set 1 |
| faith recharge rate (per s) | 35 | 2 | Fanaticism (tech 20): +1.5; Babylonian civ bonus (effect 82): +0.75 |
| conversions (statistic) | 41 | 0 | +1 per conversion |
| heal rate multiplier | 56 | 0 | Medicine (tech 119): set 3 |
| martyrdom | 57 | 0 | Martyrdom (tech 120): set 1 |

Unit modifiers in real data: Astrology (tech 22) adds 0.3 to Priest
`work_rate` (1 → float 1.3, 1.2999999523); Egyptian civ effect 83 and
Afterlife (tech 18) add 3 to Priest range; Mysticism (tech 21) doubles Priest
hp. Effect command 1 mode 0 sets, mode 1 adds (`src/effects.cpp:183-195`, M).
Civ ids used by hard-coded rules: Palmyran 15, Macedonian 16
(`include/tribegam.h:26-27`); the dat's civ 15 is "Palmyra", 16
"Macedonian".

## 3. Constants (`src/game_globals.cpp`)

| name | value | ref | use |
| --- | --- | --- | --- |
| `g_conversion_random_scale` | float 3.051851e-05 (≈ 1/32767) | `:331` | `rand()` → [0, 1] |
| `g_conversion_special_player_factor` | 4.0 | `:332` | Macedonian-owned target |
| `g_conversion_special_group_factor` | 8.0 | `:333` | chariot classes |
| `g_heal_attribute_threshold` | 0.1 | `:336` | heal-rate attribute applies only above this |
| `g_heal_distance_threshold` | double 0.5 | `:337` | heal leash |
| `g_repair_distance_offset` | 2.0 | `:343` | subtracted from distance |
| `g_repair_distance_threshold` | double 0.4 | `:344` | repair reach |
| `g_trade_positive_amount_threshold` | 0.0 | `:345` | "has cargo / has goods" |
| `g_trade_distance_modifier_factor` | float 0.00025125628 (≈ 1/3980) | `:346` | gold per squared tile |
| `g_trade_distance_modifier_scale` | 0.7 | `:347` | |
| `g_trade_minimum_transfer_modifier` | 0.35 | `:348` | floor value |
| `g_trade_modifier_threshold` | double 0.35 | `:349` | floor test |
| `g_trade_max_transfer_amount` | 75.0 | `:350` | gold cap per trip |
| `g_trade_zero_value` | double 0.0 | `:367` | retry timers |
| hard-coded | heal approach range 0.4 | `src/tact_hea.cpp:89` | |
| hard-coded | faith start / max 100 | `src/t_c_obj.cpp:89-92`, `:150-152` | |
| hard-coded | retry wait −0.5 s | `src/tact_trd.cpp:235`, `:268`, `:351` | trade |
| hard-coded | repair wait 1.0 s | `src/tact_rep.cpp:121`, `:293` | repair state 10 |

Object groups (`include/m_s_obj.h:23-52`): trade boat 2, building 3,
civilian 4, priest 18, transport boat 20, fishing boat 21, war boat 22,
chariot archer 23, wall 27, flag 30, chariot 35. Master ids
(`include/m_s_obj.h:151-308`): town centre 109, flare 112, repair man 156,
ruins 158 and 163, artifact 159, wonder 276. Resources (`include/player.h:5-11`):
food 0, wood 1, stone 2, gold 3, faith 34.

## 4. Convert (`src/tact_cnv.cpp`)

### 4.1 Faith

- A priest is created with 100 faith held as its carried attribute
  (`src/t_c_obj.cpp:89-92`).
- Every object update of an active priest adds
  `attr35 × world_time_delta_seconds`, clamps at 100, before the base update
  (`src/t_c_obj.cpp:146-155`, M). The action itself runs inside the base
  update (inferred: the base update is where actions run), so on any step
  faith is recharged first.
- Faith is set to 0 by: a successful roll (`src/tact_cnv.cpp:326`), a
  martyrdom (`:383`), and **any ally check abort while in state 4, 6 or 7**
  (`:228-231`), even with no attempt made.

### 4.2 Order start: `first_in_stack(first_time)` (`src/tact_cnv.cpp:58-131`)

With a target, in this order (the group tested is the target's):

1. Record whether the target already has the priest's owner (`:63-67`).
2. Target is a town centre, wall, artifact, ruins or wonder: AI owner → state
   11 (walk to the point), human → state 13 (fail); notification for TC or
   wonder (`:69-87`).
3. Priest faith below 100 → state 13 with "no faith" notification (`:88-92`).
   This is the only faith check; a later attempt needs no faith.
4. Range: target is a building → 1.0, else the priest's `weapon_range`
   (`:93-97`).
5. Target group flag → state 13 (`:98-101`).
6. Target is a priest and the priest's owner has attr 27 ≤ 0 → 11 (AI) / 13
   (`:102-110`); building and attr 28 ≤ 0 → same (`:111-119`).
7. Then: first time with a target → state 4; first time without → state 3;
   otherwise state 3 (`:121-130`).

### 4.3 States

| state | entry (`set_state`, `:133-202`) | per step (`update`, `:204-347`) |
| --- | --- | --- |
| 3 | ask unit AI for a task; idle sprite | nothing |
| 4 | latch target position; move-to sub-action with `requiredRange` | sub-action done → 6; target invalid / lost → drop target, 11; failed → 13 |
| 6 | move sprite | turn towards target; facing → 7 |
| 7 | work sprite, sound; **flare** if target owner id > 0; `timer = work_val2` | §4.4 |
| 11 | move-to point, range `requiredRange` | done → 3; failed → 13; invalid → 11 |
| 13 | idle sprite | notify "failed", → 2, return FAILED |
| 1 | idle sprite | return REMOVE |

Checks run before the state switch on every step, in order (`:205-237`):
target id gone → drop target, state 3; secondary target gone → drop it;
target not active (state ≠ 2, so also a construction site) → drop, state 3
(the decomp flags an AI priest loop here, `:219-221`); **target owner is the
priest's owner or an ally** → zero faith if state is 4, 6 or 7, state 1,
notify, return TARGET_INVALID.

### 4.4 The roll (state 7, `src/tact_cnv.cpp:286-333`)

Each step in state 7, in order:

1. Notify the target "attacked" (`:291-294`), every step.
2. `timer -= world_time_delta_seconds` (`:295`).
3. If `timer ≤ 0` (`:296`):
   1. If the target's owner id > 0: target's owner creates a flare at the
      priest's position (`:297-301`).
   2. `r = rand()` (`:302`).
   3. `chance = float(r) × g_conversion_random_scale` (`:303`).
   4. Resistance (`:308-318`): target owner civ is Macedonian →
      `chance × 4`; else target group is a boat (2, 20, 21, 22) or priest →
      `chance × 2`; else chariot or chariot archer → `chance × 8`; else ×1.
      The civ test wins: a Macedonian boat is ×4, not ×8 or ×2.
   5. Success iff `chance ≤ work_val1 × work_rate` (`:320`) — the priest's
      task value times the priest's work rate.
   6. On success, in order (`:321-327`): notification; target
      `change_ownership(priest owner)`; owner attr 41 += 1; priest faith = 0;
      `set_state(3)`.
   7. Always (success or not): `set_state(4)` (`:329`), which restarts the
      approach; the next state 7 entry sets `timer = work_val2` again.

After a success the target is the priest's own, so the next step's ally
check zeroes faith (already 0) and ends the action with TARGET_INVALID.

Success thresholds as integers (computed with float stores, see §8): with
`work_val1 × work_rate = 0.3` success iff `r ≤ 9830` (×1), `≤ 4915` (×2),
`≤ 2457` (×4), `≤ 1228` (×8). With Astrology (`work_rate` 1.3, product
0.39000002): `≤ 12779`, `≤ 6389`, `≤ 3194`, `≤ 1597`. So one attempt
succeeds with probability 9831/32768 ≈ 30.0 % for a plain target.

### 4.5 Martyrdom (`src/tact_cnv.cpp:366-385`, `src/t_c_obj.cpp:202-210`)

When an active priest dies and its owner has attr 57 ≥ 1 and its current
action is a convert in **state 7** whose target is not a priest: the target is
converted at once (same effects as §4.4 step 6), no roll, no flare. Then the
priest dies normally.

### 4.6 What a conversion does (`src/t_c_obj.cpp:240-286`, M)

Artifacts go through the base path (`:249-252`). Otherwise, only if the new
owner has this master id: unselect, remove the master's flag-2 attribute
contributions from the old owner, move the object between player lists,
unexplore old owner's view, switch owner, take a private copy of the master
(`:269-272`, so the object keeps its old civ's stats), explore, add the
contributions to the new owner, purge unit-AI notifications, notify. Buildings
first remove flag ≥ 4 contributions, cut the production queue to one item
and clear their actions (`src/t_b_obj.cpp:394-420`, D). No `rand()` call is
made directly in these bodies.

### 4.7 Port status (convert)

Ported in `packages/sim/src/priest.ts` (`updateConvert`, the roll
`conversionSucceeds`, `martyrdom`, faith `rechargeFaith` from
`objects.ts`) and `World.changeOwnership` (`world.ts`, §4.6 and
`TRIBE_Building_Object::change_ownership`). Human players only: the
computer-player branches (state 11 instead of 13 on a refusal, the AI's
own target picking) are not ported. What the port settles that §4.6 leaves
open, from the decomp:

- There is no convert or heal command on the wire. A right click is a
  `work` order (`do_command_work` → `work2`, the sim's `work`/`attack`
  commands); the task list's priest pass
  (`TRIBE_Task_List::get_target_task`, `src/ttsk_lst.cpp:113-143`) picks
  convert for a living object of a player who is neither Gaia, the
  priest's owner nor an ally (not an artifact), heal for the owner's or an
  ally's object short of hit points that is not a boat, artifact, wall or
  building, and nothing else (the priest walks). `ORDER_CONVERT` / `HEAL`
  (0x2C0 / 0x2BF) are issued only by computer players; ported in the unit
  AI's `processOrder` anyway.
- The priest unit AI (`TribePriestUnitAIModule`, `unit-ai.ts`
  `priestNotify`, `bestUnitToHeal`, `canConvert`): a human's priest never
  picks a convert target on its own; attacked with full faith it converts
  the attacker (`attackObject` → `canConvert`); a heal that ends heals the
  next hurt unit within distance 4; a convert that fails or ends stops it.
- A converted object keeps running its actions until its unit AI reads
  the 0x20B note (`src/aiuaimod.cpp:3302-3318`): then its actions, target,
  orders and notes go. A building's research is dropped without refund
  (its action is deleted, `~TRIBE_Action_Make_Tech`), its queue cut to one
  of the unit in training, now trained for the new owner.
- Population moves with the flag 1/2 storages (attribute 11) and a
  building's flag ≥ 4 storages (a House's room); the civilian and military
  counts (attributes 37, 40) stay with the old owner (decomp `@bug`,
  `src/t_c_obj.cpp:233-238`, kept). A built building runs its on-build
  object and tech for the new owner (a Temple completes tech 17, the
  Priest). Sight moves (unexplore for the old owner, explore for the new);
  visible-unit records take the new owner. Elimination follows on the next
  per-second check (victory.md).
- Only Town_Center1 (109) is refused; Town_Center2 (71) can be converted.
- Martyrdom triggers on the delete command (`cancel_object` →
  `die_die_die`, `src/t_c_obj.cpp:198-210`). A priest killed in combat
  does not pass there (damage only lowers hp); the other callers are
  cheats (`src/tworld.cpp:1201-1255`; in a multiplayer game only HARI KARI,
  with Enable Cheating, chat.md §7.2), scenario objects and quick-build.
- A converted object's private master (`Entity.ownMaster`) is skipped by
  the owner's later tech effects and freed by a transform; it is in the
  snapshot and the hash.
- Client (hud.md "Command buttons"): the Priest's Heal and Convert buttons
  arm an order mode whose click sends `work` on the target its task list
  gives action 105 or 104 (`targetActionType` in `gather.ts`); a right click
  does the same. The ring cursor (mcursors facet 5) shows over such a
  target. On a conversion the old owner hears convwarn (game sound 13) and
  loses the object from its selection and numbered groups
  (`unselect_one_object`); the colour follows the new owner. Test:
  `e2e/tests/siege-priest.spec.ts`.

Tests: `packages/sim/src/priests.test.ts` (roll vectors §4.4 and §10.1,
range, rejuvenation, Monotheism, buildings, Temple, Martyrdom, owner
change, victory, fog, snapshot), `samplePriestReplay` in the determinism
e2e.

## 5. Heal (`src/tact_hea.cpp`)

- Start (`:46-57`): target is a boat (2, 20, 21, 22) → **no state is set**;
  the action stays in its initial state 0 (`src/action.cpp:98`), which
  `update` does not handle, so the priest stands still holding the order.
  Otherwise state 4 with a target, 3 without.
- Approach: state 4 moves to the target with fixed range 0.4 (`:85-97`);
  state 11 moves to a point with range 0 (`:73-83`).
- Pre-checks (`:120-140`): target gone or not active → state 3; target owner
  neither self nor ally (Gaia never qualifies) → state 1, TARGET_INVALID.
- State 7, each step (`:188-223`):
  1. If the target's x or y differs from the latched position: compute
     distance; if it exceeds both `work_range` (0 for the Priest) and 0.5 →
     state 3; else re-latch the position. **No healing this step either way**
     (`:194-204`). A walking target is never healed.
  2. `work = work_val1 × work_rate`, then `× world_time_delta_seconds`, then
     `× attr56` only if attr56 > 0.1 (`:206-210`).
  3. `result = target.heal(work)`: 1 (full) → state 3; 2 (could not pay) →
     notify, state 2 (`:212-221`).
- `heal(work)` on a non-boat unit (`src/t_c_obj.cpp:982-988`) is
  `RGE_Static_Object::heal` (`src/stat_obj.cpp:2224-2237`): `hp += work`; if
  `hp ≥ max hp` set hp to max, return 1; else 0. Free.
- No `rand()` call anywhere in the heal path.
- Port status: ported in `packages/sim/src/priest.ts` (`updateHeal`, the
  free `heal` of `repair.ts`); the paid boat and building heals are not
  reached from a priest (its heal task never takes a building or a boat;
  the boat start above sets no state). They are the repairer's, §6.3. Tests: `priests.test.ts` "§5" (Example C, a walking target,
  buildings and enemies).

## 6. Repair (`src/tact_rep.cpp`, `update` is N)

Port status: ported in `packages/sim/src/repair.ts` (the command and its
other ways in: commands.md §4), boats included (`meet_target`, the state 10
boat order, the paid boat heal: naval.md §6). Convert and heal: §4.7,
§5. Trade is not ported (no trade boats in the sim).

### 6.1 Start

- `TRIBE_Combat_Object::repair` turns the unit into the owner's Repair_Man
  (156) before picking the task (`src/t_c_obj.cpp:593-596`); `do_repair`
  does the same and picks the first repair task whose class equals the
  target's, or class −1/0 for any building master (`src/t_c_obj.cpp:1020-1048`).
- `first_in_stack`: first time with a target → 4, else 3 (`:68-74`).
- The target constructor and `work` call `meet_target` (`:39`, `:342`): for a
  boat target, if another repair man already serves it, copy its rendezvous;
  else find the first suitable tile on the line from the boat to the repairer
  and order the boat to move there, remembering its `command_flag`
  (`:354-391`).

### 6.2 States

| state | entry (`:76-165`) | per step (`:167-314`) |
| --- | --- | --- |
| 4 | latch target position; move-to target with the repairer's `weapon_range` (0 for 156) | sub-action REMOVE / COMPLETED / FAILED → reach test; invalid or lost → abort; else wait |
| reach test | | `d = distance_to_object − 2.0`; `d ≤ 0.4` → 6, else 10 (`:225-232`) |
| 10 | idle sprite; `timer = 1.0`; boat target still under the same command → order it to the repairer (`:119-133`) | count down; at ≤ 0 redo the reach test: pass → 6, else `timer = 1.0` (`:282-296`) |
| 6 | latch position; move sprite | turn towards; facing → 7 |
| 7 | work sprite, sound | below |
| 11 | move-to point, range 0 | invalid → 11; anything else final → 1 |
| 1 | drop target; notify "completed" unless a sub-action; idle sprite | return REMOVE |
| 13 | | notify failed, → 2, FAILED |

Pre-checks (`:171-191`): target gone, not active, or neither self nor ally →
drop target, state 1, return CONTINUE. The decomp notes that state 10 never
gets a sub-action, so an out-of-reach repairer idles until the timer test
passes (`:116-118`); the per-second test is the only way out.

State 7 per step (`:245-277`):

1. Target moved (x or y differs): if `distance − 2.0 > 0.4` → state 3, else
   re-latch; no repair this step.
2. `amount = float(work_val1 × world_time_delta_seconds) × work_rate`
   (note the order differs from heal).
3. `result = target.heal(amount)`: 1 → state 1; 2 → notify, "cannot repair"
   notification, state 2.

### 6.3 Paid healing (buildings and boats)

Building (`src/t_b_obj.cpp:215-227`) and boat (`src/t_c_obj.cpp:990-999`)
targets scale and pay (the building side is also `economy.md` §4.5):

- `h = amount × hp_max / build_pts_required` (for buildings both are taken
  as integers then floats); clamp so `h + hp ≤ hp_max`.
- `modifier = h / (2 × hp_max)`; `pay_obj_cost(target master id, modifier,
  ignore_pop)` with `ignore_pop` 0 for buildings, 1 for boats.
- Paid → `hp += h` as §5 (return 1 when full); not paid → return 2, stop.

`check_obj_cost` (`src/tplayer.cpp:1031-1078`) tests each of the 3 cost rows
with `type ≥ 0` against `amount × modifier`: a pop-headroom row fails when
population ≥ limit (unless ignored); a row the player cannot cover fails if
the row's flag is 0, or if gold replacement (attr 29 ≥ 1) cannot cover it.
`pay_obj_cost` (`:1080-1099`) then subtracts `amount × modifier` for rows with
flag ≠ 0 (and type ≠ 4 when ignoring pop); a shortfall comes out of gold.

So repairing a full bar costs half the target's build cost, and the rate is
`work_val1 × work_rate × hp_max / build_pts_required` hp per second.

Town centre: cost row "attribute 30 × 1, flag 0" is a requirement only: the
repair fails while attr 30 < `modifier`. In real data attr 30 starts 0, each
age tech adds 8 (effects 94-97) and every building master holds `−1`, flag
2. `new_game` then sets attr 30 to 500 for every player (economy.md §6.4,
`world.ts` `NEW_GAME_ATTRIBUTES`), so it does not block repair at the start;
whether play can bring it to ≤ 0 is **unverified**.

No `rand()` call in the repair path itself; the boat `moveTo` orders and the
move-to sub-actions draw as `movement.md` §11 describes.

## 7. Trade (`src/tact_trd.cpp`, `update` is L)

### 7.1 Start and retarget

- Cargo type: if the boat's held attribute is not food, wood or stone it is
  set to wood (`:56-59`, again at `:307-310`). The player picks it with the
  trade-attribute command (§7.6).
- An idle trade boat holds a Trade action: the trade task (task 0, action
  111 on unit 45, `is_default` 1) is its master's `default_task`, which an
  active object with no action starts (`src/act_obj.cpp:403-407`) through
  the point constructor: no target, so state 2.
- `work(obj)`: own drop-site (dock 45) → it becomes the home dock, state 8;
  another object → trade target, state 4; a point → state 11 (`:470-498`).
  `move_to` treats an own dock the same way (`:447-468`).
- First time: target → 4, none → 2 (`:60-68`).

### 7.2 Per step (`:186-412`)

Pre-checks: drop targets that are gone or pending removal (`:187-199`);
**target owned by the boat's owner** → drop both targets, state 1,
TARGET_INVALID (`:203-213`). An ally's dock is valid. The home dock's owner is
never re-checked (decomp note `:201-202`).

| state | entry (`:71-182`) | per step |
| --- | --- | --- |
| 4 | latch position; move-to target with `work_range` (0) | if `timer < 0`: wait it out, then re-enter 4 (or 3); else sub-action done → 6; failed / invalid → `timer = −0.5`; lost → 3 (`:248-278`) |
| 6 | move sprite | turn; facing and (target holds > 0 **or** target is a farm or dock) → 7 (`:280-295`; `keepGatheringWhenObjectIsOut` is true for the dock, `src/t_c_obj.cpp:665-671`) |
| 7 | work sprite; record pick-up point = target position (`:126-138`) | load, below |
| 8 | cargo > 0: find a home dock if needed (nearest own active 45), move-to it with range 0; none → notify, 13 (`:140-170`) | deliver, below |
| 11 | move-to point | same −0.5 s retry pattern (`:219-246`) |

Load (state 7, `:297-336`), all at once in one step:

1. `max = float(int(capacity))` (20); `give = max − held`.
2. `give = min(give, own stock of the cargo resource, target owner's attr 9)`.
3. Own stock −= give; target owner's attr 9 −= give; held += give.
4. `held ≥ max` → 8. Target owner's attr 9 ≤ 0 and target not a dock → 8.
   Since the target is a dock, the boat otherwise **stays in state 7**, taking
   more each step as trade goods regrow (§7.4).

Deliver (state 8 sub-action done, `:354-397`), only when the home dock still
exists and cargo > 0:

1. If pick-up x or y < 0 → `modifier = 0.35`; else
   `modifier = (dx² + dy²) × 0.00025125628`, then `× 0.7`, with `dx, dy` from
   the pick-up point to the home dock's position (`:366-373`).
2. Owner civ Palmyran → `modifier × 2` (`:374-376`).
3. `modifier < 0.35` → 0.35 (`:377-379`).
4. `gold = held × modifier`; above 75 → 75 (`:381-384`).
5. Owner gold += `gold` (counted as earned gold, attr 49,
   `src/tplayer.cpp:3661-3664`); cargo = 0 (`:388-389`). The cargo's own
   resource is not returned: the player spent it at loading.
6. Back to 4 if the trade target still exists, else 3.

The gold cap is reached at modifier 3.75, i.e. squared distance ≥ about
21 322 (≈ 146 tiles) for a 20-unit cargo, half that squared distance for
Palmyrans.

### 7.3 Timing

Loading is instant (one step) when goods are available. The −0.5 s retry
timers count up by `world_time_delta_seconds` and restart the state on the
step they become > 0.

### 7.4 Trade goods (`src/tplayer.cpp:352-375`, M)

Each player update adds the step's seconds to `update_time`; for each whole
second passed (`while update_time > 1.0`), `attr 9 += attr 10` (1 in real
data), capped at 100. This runs for every player, with or without a dock.
Every civ starts with attr 9 at 0 and attr 10 at 1 (dat), so a Dock's owner
has no goods for the first seconds and at most 100 after 100 s.

### 7.5 Orders and the trade ship unit AI

- A right click (`work2`, `economy.md` §3.1) on a Dock 45, any owner's,
  picks the trade task through the task list's id pass (task 0 names unit
  45 with owner type 0). The idle boat's Trade action runs the same task,
  so it takes `work(dock)` (§7.1): another player's Dock is the target
  (state 4), an own Dock the home Dock (state 8). A Dock of another id
  (Dock_2 133 only ever exists as an upgrade of 45's master) is not matched.
- A move order is the action's `move_to` (state 11). So is a right click
  with no target and no terrain task (open water): `work2` finds no task and
  calls `move_to` (`src/act_obj.cpp:111-138`), which the current action
  takes first (`action_move_to`); only without one does a plain move replace
  the actions. The same holds for a Transport, a gatherer (gather state 15)
  or a builder (port: `gather.ts` `startTask`).
- `TRIBE_Combat_Object::trade(id, unconditional)` (`src/t_c_obj.cpp:638-662`,
  M): a Trade action already on that target is kept unless unconditional;
  a Trade action takes `work(target)`; else `getTask` and a new Trade action
  replace every action.
- `TribeTradeShipUnitAIModule` (`src/taiuaimd.cpp:1219-1401`): ATTACKED is
  the fishing ship's reaction (naval.md §5.2, same code: alert, help call,
  a human boat with an order keeps it, else re-queue its order unless it
  moves, stop, run away). REQUEST_TASK (state 3's entry) while its current
  action is TRADE: the closest active Dock 45 in its search results, self
  or ally first (`closestObject(-1, 0, …)`), then neutral (`…1…`); the first
  found is traded with (`tradeWithObject(id, 1)`: `trade(id, 1)`, then action
  TRADE and the target recorded). Not found, or another action: drop the
  target and `stopObject(1)`. An own Dock found this way only becomes the
  home Dock: an empty boat with no target then cycles 8 → 3 every step and
  asks again (decomp as read; harmless). The explore branch and
  `processIdle` act for computer players only.

### 7.6 The trade-attribute command (`src/tcommand.cpp:489`, `:904`, M)

`TRIBE_Command_Trade_Attribute` (command 0x6D): a unit count, the unit ids
and `attribute` (a long). The receiver sets each listed object's
`attribute_type_held` to `(short) attribute`, nothing else: the held amount
is kept, and no owner check. The sender (`TRIBE_Player::command_trade_attribute`,
`src/tplayer.cpp:942`) lists its selected active objects of select level ≥ 4
and `unit_level` 5 (only the trade boats 15/16 in the 1.0a dat); the trade
panel's three buttons send food 0, wood 1, stone 2 (`src/scr_game.cpp:2057-2063`).

### 7.7 Port status (trade)

Ported (`packages/sim/src/trade.ts`): the Trade Boat 15 and Merchant Ship 16
(tech 6 copies 16 into 15: 250 hp, speed 2.5), the Trade action as §7.1-§7.3
(states 1-4, 6-8, 11, 13, the −0.5 s retries, the pick-up point on
`WorkAction.pickUpX/Y`, the gold formula `tradeGold`, gold earned attr 49),
the default task (`objects.ts`), orders (`gather.ts`: `startTask`,
`workMoveTo`, `updateWork`), the trade goods regrowth (`world.ts`
`updatePlayer`, `regrowTradeGoods`), the trade ship AI (`unit-ai.ts`
`tradeShipNotify`), `trade(id, unconditional)` (`aiTrade`) and the command
`{ type: 'trade-attribute', units, attribute }` (`commands.ts`, `world.ts`
`doCommandTradeAttribute`, hash id 19; port-side guards: the sender's
active objects of `unit_level` 5, `attribute` 0-2). Tests `trade.test.ts`;
replay `sampleTradeReplay` in the determinism e2e. Client (hud.md "Boats:
transports and trade"): the three trade buttons send `trade-attribute`, a right
click on another player's Dock sends the `work` order (with the normal cursor,
as the original), the panel shows the good or the gold. Not ported: the work
and deposit sounds (the client's), the computer-player branches.

## 8. RNG calls, in order

| action | draw | when | ref |
| --- | --- | --- | --- |
| convert | flare creation: `rand()` then `srand(r)` | entry to state 7, if target owner id > 0 | `src/tact_cnv.cpp:179-183`; object setup fence `src/stat_obj.cpp:279-286` |
| convert | flare creation again | timer expiry, before the roll, same condition | `src/tact_cnv.cpp:297-301` |
| convert | one `rand()` for the roll | timer expiry | `src/tact_cnv.cpp:302` |
| heal | none | | |
| repair | none in the action; boat `moveTo` and move-to sub-actions as `movement.md` | | |
| trade | none in the action; move-to sub-actions as `movement.md` | | |

- The flare is master 112, type 10 (static) in real data, so only the
  static setup fence draws (no random facing, `movement.md` §1; same row
  as the attack flare in `combat.md`'s RNG table); its later
  removal falls under the death rule (rand, then srand) handed over by
  economy/combat — **unverified** for flares.
- Net effect of a convert attempt on the stream, from state `S`:
  `a = rand()`, state := `a`, `r = rand()`. So `r` depends only on the 15-bit
  `a`.
- Each step in state 7 also notifies the target "attacked"; what its unit AI
  does with that (and whether it draws) is outside this spec,
  **unverified**.

## 9. Timing in sim steps

Default multiplayer step: 90 ms at speed 1.0 (`core.md` §2.2), so
`world_time_delta_seconds = float(90 × 0.001) = 0.090000004`.

| quantity | per step | per second | full |
| --- | --- | --- | --- |
| faith, base 2/s | +0.18000001 | 2 | 0 → 100 in 556 steps (50.04 s) |
| faith with Fanaticism (3.5/s) | | 3.5 | 318 steps |
| convert attempt | | | first roll 34 steps after state 7 entry (timer 3.0 → −0.06) |
| priest heal (3 × 1) | 0.27000001 | 3 hp | Medicine: 0.81000006 / step |
| repair, building class (0.75 × 0.4) | `amount` 0.027000001, ×hp/trainTime | TC: 3 hp (600/60) | |
| repair, boats (5 × 0.4) | `amount` 0.18000001, ×hp/trainTime | trade boat: 8 hp (200/50) | |

Between two convert attempts the priest re-enters 4 → 6 → 7: at least one
step each for 4 and 6 before the 34-step timer runs again (the exact count
depends on the move-to sub-action, **unverified**).

## 10. Worked examples (test vectors)

Floats are rounded to single precision at each store (`Math.fround`); the RNG
is `core.md` §4.1. "RNG state" is the 32-bit state at the moment the action
runs.

### 10.1 Example A — conversion success from state 14

Egyptian priest (wv1 0.3, work_rate 1, wv2 3), target an enemy Clubman of
player 2 (non-Macedonian, not boat/priest/chariot). Timer expires; RNG state
14 (for instance right after the step's `srand(14)` with no earlier draws).

| step | state after | value |
| --- | --- | --- |
| flare setup `rand()` | 5 527 193 | 84 |
| `srand(84)` | 84 | |
| roll `rand()` | 20 508 103 | r = **312** |
| `chance = 312 × 3.051851e-05` | | 0.0095217749 |
| threshold `0.3 × 1` | | 0.30000001 |

`0.0095 ≤ 0.3` → converted; attr 41 = 1; faith 0. Next step the ally check
ends the action. Faith is back to 100 after 556 steps.

### 10.2 Example B — failure, then Astrology flips it

Same, RNG state 1057: flare draws 3490 (state := 3490), roll draws
r = **11435**, `chance = 0.34897915`. Plain priest: `0.349 > 0.3` → fail, back
to state 4. With Astrology (`work_rate` 1.3, threshold 0.39000002):
success. Same state against a Macedonian target: `chance × 4 = 1.3959` → fail
either way.

Boundary vectors: r = 9830 → chance 0.29999695 succeeds; r = 9831 →
0.30002747 fails. Boat target at RNG state 3490: flare 11435, roll
r = 4612, `× 2 = 0.28150273` → succeeds (≤ 4915); as a chariot `× 8` → fails.

### 10.3 Example C — priest heal timing

Priest heals a friendly Priest at 10 / 25 hp, standing still, 90 ms steps.
`work = float(float(3 × 1) × 0.090000004) = 0.27000001`. After 55 steps hp is
below 25; on step **56** it reaches ≥ 25, is clamped to 25, `heal` returns 1
and the action goes to state 3. With Medicine (attr 56 = 3 > 0.1):
`work = 0.81000006`, full on step **19**.

### 10.4 Example D — town centre repair cost

Villager-turned-Repair_Man (wv1 0.75, work_rate 0.4) on a Town_Center1 at
300 / 600 hp, 90 ms steps, owner with ample wood and attr 30 > 0.

- `amount = float(float(0.75 × 0.090000004) × 0.4) = 0.027000001`.
- `h = 0.027000001 × 600 / 60 = 0.27000001` hp per step.
- `modifier = h / 1200 = 0.000225`; wood per step `200 × modifier = 0.045`.
- Full after **1112** steps (100.08 s); wood spent with float stores from
  1000: 1000 → 950.01862 (≈ 50 = half of 200 × 300/600).

### 10.5 Example E — trade gold

Trade boat (capacity 20, loaded with 20 wood) picks up at a foreign dock at
(10.5, 10.5) and delivers to its home dock at (60.5, 70.5):
`dx² + dy² = 2500 + 3600 = 6100`; `modifier = float(6100 × 0.00025125628)
× 0.7 = 1.0728643`; gold = `20 × 1.0728643 = 21.457287`. Palmyran:
`modifier 2.1457286`, gold 42.914574. Pick-up (20.5, 20.5) → dock
(30.5, 25.5): squared distance 125, modifier 0.0219… < 0.35 → 0.35, gold 7.
Pick-up (5.5, 5.5) → (125.5, 105.5): modifier 4.2914572, `20 × m = 85.8` →
capped to **75**.

## 11. Implications for the port

- Implement each action as the state machine above with the same state
  numbers; the decomp's entry side effects (flare, timer reset, faith zeroing)
  happen in `set_state`, so a port that sets the state field directly will
  drift.
- Conversion consumes 3 RNG draws per attempt with a non-Gaia target (flare
  pair + roll) plus one flare pair at each state 7 entry; skipping the flare
  objects breaks the stream. The flare must be a real sim object owned by the
  **target's** owner.
- Compare `float(r) × 3.051851e-05f` with the threshold; integer thresholds
  in §4.4 are safe test oracles (the nearest r is ≥ 3e-6 from the boundary,
  far above any x87-vs-float difference).
- Hard-code the civ/class factors, the dock id rule, the gold resource and the
  75 cap as the original does; the data's trade task `work_val1` (50/100) is
  not read by the trade action.
- Heal and repair stop healing on every step the target moves; keep the
  exact float order (heal: `wv1 × rate × dt`; repair: `(wv1 × dt) × rate`).
- Faith regenerates in the object update before the action runs; zero it on
  the ally abort too.
- Trade goods are a per-player pool (attr 9) regrowing 1/s to 100, drained by
  **foreign** boats loading at that player's docks.
- Converted units keep a private copy of their old master (`own_master`), so
  their stats do not follow the new owner's techs: the port needs per-object
  master overrides.

## 12. Unverified or inferred

- `TRIBE_Action_Repair::update` (N) and `TRIBE_Action_Trade::update` (L)
  were not byte-proven; §6.2, §6.3's call site and §7.2 rest on them.
- Beta vs retail 1.0a: all constants and the hard-coded civ rules
  (Macedonian ×4, Palmyran ×2) are beta code; `beta-only?` until a retail
  recording confirms. The trade constants are in the 1.0a exe's data side
  by side as in the beta's globals: float 0.00025125628, 0.7, 0.35 and the
  double 0.35 at file offsets 0x14beb0-0x14bec0 of `Empiresx.exe`.
- x87 precision: float stores assumed at each local (`core.md` §3); the
  examples' last digits depend on it, the convert thresholds do not.
- Whether attr 30 can block building repair in normal play (§6.3).
- Flare removal RNG, unit-AI reaction to the per-step "attacked" notify, and
  the exact step count for 4 → 6 → 7 between attempts.
- Which objects the Priest heal task accepts: settled, §4.7 (the task
  list's priest pass never gives a building or a boat the heal task).
- How the trade cargo resource is chosen: settled, §7.6.
