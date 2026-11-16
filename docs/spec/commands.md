# Unit commands: stop, stand ground, repair, attack ground, formations (and the ones not ported)

Source: aoe1-decomp @ `6d6d8b1` (see `README.md` for the version caveat and
reference format). The repair action itself is support-actions.md §6; the
unit AI's orders and notifies are unit-ai.md; the grid buttons and keys are
hud.md "Command buttons" and "Hotkeys". Sim tests:
`packages/sim/src/unit-commands.test.ts` (describe titles cite the sections
here); e2e: `e2e/tests/unit-commands.spec.ts`.

## 1. On the wire

| command | original | ours (`packages/sim/src/commands.ts`) | hashed id |
| --- | --- | --- | --- |
| stop | `RGE_Command_Stop`, `command_stop` (`src/Command.cpp:897`) | `{ type: 'stop', objects }` | 9 |
| repair | `TRIBE_Command_Repair`, `command_repair` (`src/tcommand.cpp:73`, `do_command_repair` `:500`) | `{ type: 'repair', units, target }` | 11 |
| stand ground | a group AI order, `command_group_ai_order(..., UNIT_AI_ORDER_STAND_GROUND, -1, -1, -1, -1, -1, 1.0, 1, 0, 100)` (`src/player.cpp:1883`) | `{ type: 'stand-ground', units }` | 12 |
| attack ground | `TRIBE_Command_Attack_Ground`, `command_attack_ground` (`src/tcommand.cpp:852`, `do_command_attack_ground` `:442`) | `{ type: 'attack-ground', units, x, y }` | 17 |
| formation | `RGE_Command_Formation` (command 6, `unitNum`, `formationID`, the ids), `command_formation` (`src/Command.cpp:1156`, `do_command_formation` `:492`) | `{ type: 'formation', units, formation }` | 20 |

Every command is checked by `parseCommand` (ids positive integers, 1 to 255
units). Port-side guard (economy.md §5.5): objects of another player than
the sender are skipped; the original runs them.

## 2. Stop (`RGE_Command::do_command_stop`, `src/Command.cpp:262`)

Sent by `RGE_Player::command_stop` (`src/player.cpp:1824`) for the selected
objects of select level 3 or more (`get_selected_objects_to_command(.., 3, ..)`,
`src/player.cpp:1648`). Each listed object leaves its pathing group and
`stop`s:

- `RGE_Action_Object::stop` (`src/act_obj.cpp:366`): `action_stop` on the
  list, else the list is deleted. A unit drops its action (walk, gather,
  attack, repair) and stands where it is with its standing sprite.
- `RGE_Combat_Object::stop` (`src/com_obj.cpp:103`) then calls the unit AI's
  `stopObject(1)` (`src/aiuaimod.cpp:1733`): the order and target go, the
  unit is idle and its idle scan (unit-ai.md) runs from there.
- A building stops its research and empties its queue, both refunded
  (techs.md §3.5).

Ours: `World.doCommandStop` (`packages/sim/src/world.ts`) for any own active
object. Pathing groups are not ported (formations), so nothing to leave.

## 3. Stand ground (`UNIT_AI_ORDER_STAND_GROUND`, 0x2D5)

`RGE_Player::command_stand_ground` (`src/player.cpp:1883`) passes min level
−1, which `get_selected_objects_to_command` reads as 4: units only.
`do_command_group_ai_order` (`src/Command.cpp:628`) gives each listed unit an
immediate order from its own player at the unit's position, range 1,
priority 100. Ours: `standGround` in `packages/sim/src/unit-ai.ts`.

- Order start (`processOrder`, as STOP): drop the target, `stopObject(1)`.
- The order stays the unit's current order until another replaces it; a
  right-click attack replaces it (the attack order is a new order).
- Idle scan (unit-ai.md §4): the unit still searches its view for targets,
  but `attack` from a stand-ground unit never moves it
  (`TRIBE_Action_Attack::first_in_stack` and `ready_to_attack`,
  `src/act_atak.cpp:168-187`, `:499-530`): out of reach → the attack fails;
  too close (ranged) → it waits. Ours: `holdsPosition` in
  `packages/sim/src/combat.ts`, true for an immobile attacker or one whose
  current order is STAND_GROUND.
- Retaliation (`processNotify`, `src/aiuaimod.cpp:2754`, unit-ai.md §4.2):
  a hit unit standing its ground does not chase (the branches that issue a
  new attack check "order is not STAND_GROUND").
- When its attack completes or fails, a stand-ground unit drops the target
  and stays (`src/aiuaimod.cpp:3005`, `:3088`, `:3170`).
- Catapults (35, 36) and id 250 standing their ground do nothing on the idle
  scan (`src/taiuaimd.cpp:1852-1900`).

An object attack starts with its latched target position at (−1, −1, −1)
(`src/act_atak.cpp:55-57`), so the first `ready_to_attack` measures the real
distance. Our `startAttack` latched the target's position at start before
this port; a stand-ground melee unit then hit a target 3 tiles off.

## 4. Repair

The command: `TRIBE_Command::do_command_repair` (`src/tcommand.cpp:500`)
calls each listed unit's `do_repair(target)` (`src/t_c_obj.cpp:1007`): the
unit becomes its owner's Repair_Man (156) and takes the repair task for the
target (support-actions.md §6.1). The action is `TRIBE_Action_Repair` (106,
support-actions.md §6.2-6.3): walk to `distance − 2.0 ≤ 0.4`, face, heal
`(work_val1 × dt) × work_rate × hp_max / build_pts` a step, paying
`h / (2 × hp_max)` of the building's cost (half the build cost over a full
bar; worked example §10.4).

Who sends it: the Repair button (`TRIBE_Screen_Game::command_repair`,
`src/scr_game.cpp:3980`) arms a click mode with message 3052; the next left
or right click on the map runs `command_make_repair` (`src/tvw_main.cpp:449`,
`src/tplayer.cpp:995`) for the selected units of the Repair_Man's object
group, on an own building short of its hit points and not dying; otherwise
the "can't do" sound.

Other ways in:
- A right-click `work` on an own damaged building: the repair pass of
  `TRIBE_Task_List::get_target_task` (`src/ttsk_lst.cpp:82-92`; never a
  Farm, 50) gives the repair task, and the Villager swaps to the Repair_Man
  (`RGE_Action_Object::getTask`, `src/act_obj.cpp:455`).
- A builder whose finished building is damaged gets an immediate REPAIR
  order from its owner on it, range 1, priority 100
  (`src/tact_bld.cpp:155-162`; ours `orderRepair` in `unit-ai.ts`).
- The unit AI's REPAIR order runs `repairObject` (`src/aiuaimod.cpp:1884`).
- A repair the owner cannot pay for notifies "target invalid"; the unit AI
  ends it and stops (`action_finished`, `src/taiuaimd.cpp:852-863`).

Ours: `packages/sim/src/repair.ts` (`doRepair`, `aiRepair`, the state
machine), routed from `gather.ts` (action 106 shares the gather record).
Port-side guards: a missing target is skipped (the original would crash);
units not of the Repair_Man's group are skipped. Attribute 30 (the Town
Center's cost row, support-actions.md §6.3) is 500 from `new_game`
(`world.ts` `NEW_GAME_ATTRIBUTES`), so it never blocks a repair.
Boat targets (`meet_target`, the state 10 boat order, the paid boat heal)
are ported: naval.md §6.

## 5. Attack Ground

**Sender** (`TRIBE_Player::command_attack_ground(x, y)`, `src/tplayer.cpp:963`):
the selected objects that are active, the player's own, of select level 4 or
more and of `unit_level` 4 (the dat's `interface_kind`, the pack's `level`, not a
combat value; the Stone Thrower line, 35/36/280, has it) and of master type 40 or more but not a tree
(`get_selected_objects_to_command(.., 4, -1, -1, 4)`, `src/player.cpp:1648`).
The first plays its command sound. `TRIBE_Command::command_attack_ground`
(`src/tcommand.cpp:852`) packs `TRIBE_COMMAND_ID_ATTACK_GROUND`, the unit
count (a byte), the map point `location_x`, `location_y` (floats) and the
listed ids. The filter is the sender's only: the receiver runs any listed
object.

**Receiver** (`TRIBE_Command::do_command_attack_ground`, `src/tcommand.cpp:442`):
each listed object that still exists gets `attack(location_x, location_y,
0.0, 1)`. A static object's `attack(float, float, float, int)` does nothing
(`include/stat_obj.h:281`); a combat object's
(`RGE_Combat_Object::attack(x, y, z, unconditional)`, `src/com_obj.cpp:569`):

- `unconditional` is 1, so the "already attacking this point" test before it
  (which compares the point's y and z against the action's **x**, a bug) is
  skipped.
- A new ground attack action (`RGE_Action_Attack` point constructor,
  `src/act_atak.cpp:90`): target none, target point `(x, y, 0)`, range
  `weapon_range` (0 → 0.4, combat.md §3.1), `minimum_weapon_range`, the
  master's sprites, and `indirect_fire_flag = 2` (an object attack has 0).
  It replaces every action (`delete_list`, `set_only_action`). No civilian
  transformation, no unit-AI order: the unit AI keeps its current order
  (a stand-ground unit stays put, `first_in_stack`, combat.md §3.1).

**The action** is the attack state machine (combat.md §3.2) with no target:

- `first_in_stack`: a mobile unit not standing its ground walks into range of
  the point (state 4); else `ready_to_attack` measures from the attacker's
  edge to the point (`ready_to_attack`, no-target branch: the point is never
  re-latched); too close → waits (mobile) or fails (stand ground); out of
  reach while holding → fails (state 13).
- State 7: with no target, an object attack goes to state 2 (target lost,
  done); a ground attack (`indirect_fire_flag != 0`) does not
  (`src/act_atak.cpp:362`, `:380`), so the unit keeps firing at the point,
  every `speed_of_attack`, until another order replaces the action.
- `set_state` spends the flag (`src/act_atak.cpp:199-232`): every entry to
  state 4 (walking into range) takes 1 off while it is above 0, state 2 sets
  it to 0, and state 6 sets it to 0 when the action has a target. A mobile
  unit always starts in state 4 (even in reach), so it fires with flag 1; if
  it has to walk a second time (pushed out of reach) the flag reaches 0 and
  the next swing that ends goes to state 2: the attack is over. A unit that
  cannot move or stands its ground keeps flag 2.
- Each shot: `RGE_Action_Attack::do_attack` (`src/act_atak.cpp:542`) calls
  `attack(target_x, target_y, target_z, self)` (`src/com_obj.cpp:237`): a
  missile user spawns its missile as against an object (combat.md §4.2;
  no flare, `TRIBE_Combat_Object` overrides only the object overload) and
  `init_missile(launcher, x, y, z, max_range)` (`src/misl_obj.cpp:69`) gives
  it the point and no target; a melee unit does nothing (returns 0).
- The missile aims at the point (`intercept`, combat.md §5.2; z is 0), finds
  no target in its collision list (hit info 0 hits only the target), and on
  hitting the ground runs the launcher's `area_attack` at its own position
  (combat.md §5.3 step 8, §4.4). A launcher without blast radius (Ballista,
  Bowman) hurts nothing; type-0 missiles that fly past `max_range` die
  without a blast.
- `RGE_Action_Attack::work` with an object (a task-driven right click) clears
  `indirect_fire_flag` and chases the object (`src/act_atak.cpp:405`).

Ours: `{ type: 'attack-ground', units, x, y }` (`packages/sim/src/commands.ts`),
`World.doCommandAttackGround` → `combat.ts` `attackGround`; the action is
`AttackAction` with `target` −1 and `indirect` 2. Port-side guards: objects of
another player than the sender, and objects not active, are skipped (the
sender's own filter); objects without a mover or a combat block are skipped,
as `combatAttack` does. The receiver does not check `unit_level`, as the
original. The client's button and click mode: hud.md "Command buttons"
(there is no mode cursor in the original). Tests: `packages/sim/src/siege.test.ts` "commands.md §5".

## 6. Formations (`RGE_Command::do_command_formation`, `src/Command.cpp:492-578`)

**Sending.** Shift+F2 .. Shift+F7 on the game screen, while the game is on
and commands are allowed, send formations 0 .. 5
(`TRIBE_Screen_Game::handle_key_down`, `src/scr_game.cpp:1490-1519`);
`RGE_Player::command_formation` takes the player's selected objects
(`get_selected_objects_to_command(-1, ...)`), plays the first one's command
sound and sends them; it sends nothing for an id outside 0-5
(`src/player.cpp:1866-1881`). No button or string names them.

**Execution**, only when 2 or more ids are listed:

1. The reference is the listed object nearest the map origin:
   `(float)sqrt(x·x + y·y)` least, the first listed on a tie.
2. Steps: `sx` (along x) and `sy` (along y) start at 1 (formation 0), 2
   (2, 3) or 1.5 (1, 4, 5); a flag `alternate` starts clear.
3. For each listed object in list order: it leaves its pathing group, waits
   to move (`setWaitingToMove(1)`) and joins every other listed id's group.
   The reference stays where it is. Every other object walks
   (`move_to(0, x, y, 1.0)`, the same entry as a move order's, act_obj.cpp
   110-136: a gather or build action takes the walk itself; the unit AI's
   order becomes move with that point) to (x, y) from the reference's (rx,
   ry), the steps changing after each:

| formation | x | y | then |
| --- | --- | --- | --- |
| 0 (diagonal) | rx + sx | ry + sy | sx += 1, sy += 1 |
| 1 (other diagonal) | rx + sx | ry − sy | sx += 1.5, sy += 1.5 |
| 2 (line along x) | rx + sx | ry | sx += 2 |
| 3 (line along y) | rx | ry + sy | sy += 2 |
| 4 (wedge, +x) | rx + sx | ry − sy, then on the next ry + sy | after each pair sx += 1.5, sy += 1.5 |
| 5 (wedge, −x) | rx − sx | as 4 | as 4 |

The points are not clamped to the map (a move order's are). Worked example
(`formation.test.ts`): reference (10.5, 10.5), four others; formation 4
sends them to (12, 9), (12, 12), (13.5, 7.5), (13.5, 13.5).

Quirk: when the first listed id is missing, the distance compared against
is uninitialised and a missing reference would crash; the port skips missing
ids for the reference too.

Port: `World.doCommandFormation`. Port-side guard as §1: objects not the
sender's, and objects that cannot move (the original's `move_to` would give
a building a failing walk in place of its action), are skipped as missing.
Client: Shift+F2..F7 in `hud/game-hud.ts` `commandFormation` (hud.md "F11
clock and population, F5 timings, formations"; e2e `hud-rest.spec.ts`).

## 7. Boat commands

| command | original | status |
| --- | --- | --- |
| Unload | `TRIBE_Player::command_unload` (`src/tplayer.cpp:1024`) | ported (command `unload`, naval.md §7.6; the client's Unload button and click: hud.md "Boats: transports and trade") |
| Trade attribute | `TRIBE_Player::command_trade_attribute` (`src/tplayer.cpp:942`) | ported (command `trade-attribute`, support-actions.md §7.6; the client's trade buttons: hud.md "Boats: transports and trade") |
