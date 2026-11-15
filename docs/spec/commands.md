# Unit commands: stop, stand ground, repair (and the ones not ported)

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
Boat targets (`meet_target`, the state 10 boat order) are not ported: the
sim has no boats.

## 5. Not ported

| command | original | why |
| --- | --- | --- |
| Attack Ground | `TRIBE_Player::command_attack_ground` (`src/tplayer.cpp:963`), `do_command_attack_ground` (`src/tcommand.cpp:442`): each unit `attack(x, y, 0, 1)` | only units firing area-effect missiles get the button (the Stone Thrower line); the sim has none |
| Heal | `TRIBE_Combat_Object::heal` (`src/t_c_obj.cpp:552`), support-actions.md §5 | no Priest in the sim |
| Convert | `TRIBE_Combat_Object::convert` (`src/t_c_obj.cpp:525`), support-actions.md §4 | no Priest in the sim |
| Unload | `TRIBE_Player::command_unload` (`src/tplayer.cpp:1024`) | no boats in the sim |
