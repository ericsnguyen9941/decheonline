# Diplomacy and tribute

Source: aoe1-decomp @ `6d6d8b1` (July 1998 RoR beta; see `README.md` for the
version caveat and reference format). Status letters: M matching,
D accepted_drift, L accepted_logic, from `config/functions/src/<file>.cpp.json`.
Sim: `packages/sim/src/diplomacy.ts` (stances, masks, tribute),
`world.ts` (commands `relation`, `allied-victory`, `tribute`; read API
`World.relation`/`isAlly`/`isEnemy`, `World.diplomacy`), `victory.ts` (allied
victory), `unit-ai.ts`, `gather.ts`, `combat.ts`, `repair.ts` (stance checks),
`visibility.ts` (mutual masks). Tests `diplomacy.test.ts`; replay
`sampleDiplomacyReplay` in `replay.ts`, hashed by `e2e/tests/determinism.spec.ts`.

## 1. Stances

Each player keeps its own stance towards every player, `relations[q]`, one of
`RGE_RELATION_ALLY` 0, `NEUTRAL` 1, `ENEMY` 3 (`include/player.h:14-16`). A
stance is **one-sided**: player 1 may call 2 an ally while 2 calls 1 an enemy.

- Start: `RGE_Player`'s constructor sets every entry NEUTRAL
  (`src/player.cpp:126-136`), then `TRIBE_Player`'s sets every other player
  from 1 up to ENEMY (`src/tplayer.cpp:252-260`). Gaia stays NEUTRAL, and so
  does the player towards itself. `new_game`'s team alliances
  (`src/world.cpp:1013-1029`) need lobby teams, which the port has not.
- `set_relation` [M] (`src/player.cpp:1263-1282`) stores the stance and the
  unit AI's bucket for that player, `unitDiplomacy[q]`: 0 Gaia, 1 self,
  2 ally, 3 neutral, 4 enemy (`include/player.h:19-23`). The port derives the
  bucket from the stance (`diplomacy.ts` `unitDiplomacy`).
- `isEnemy` [M] (`src/player.cpp:288-294`): another player 1 and up whose
  stance is ENEMY. `isAlly` [M] (`:296-304`): itself, or a player 1 and up
  whose stance is ALLY. `isNeutral` (`:306-312`). All read only the asker's
  own stance.
- Allied victory `allied_victory` (`set_allied_victory` [M], `:1251`) and
  allied line of sight `allied_LOS_Enable` (§3) start off.

## 2. Effects on combat and tasks

All read the stance of the acting object's owner towards the other owner.

- Auto-attack search: `UnitAIModule::search` files every visible object under
  its owner's `unitDiplomacy` bucket (`src/aiuaimod.cpp:1121-1150`);
  `bestUnitToAttack` [M] walks buckets 4 (enemy) down to 2 and skips a target
  whose owner its owner `isAlly` (`:1248`, `:1304`, `:1357`), so it attacks
  enemies and neutrals, never allies (ally objects stay in the list but are
  skipped).
- Neutrals: `canAttackUnitAtNeutrality` decides if a neutral object may be
  attacked. Base 1 (`src/aiuaimod.cpp:1728`); civilians 0
  (`src/taiuaimd.cpp:533`); soldiers not object groups 3, 27, 4, 21, 2, 20
  (`:1681`); towers not 3, 27, 4, 21, 2 (`:2203`). Example: a Clubman leaves a
  neutral Villager alone but attacks a neutral Clubman; a Watch Tower leaves a
  neutral Villager alone.
- Help: `askForHelp` [M] answers when the helper has the asker's owner, or the
  helper's owner calls the asker's owner an ally (`src/aiuaimod.cpp:2494`,
  `:2515`).
- Attack action: on each update, a target whose owner the attacker's
  (non-Gaia) owner calls an ally ends the action (state 1), notifies
  TARGET_INVALID unless it is a sub-action, and returns TARGET_INVALID
  (`src/act_atak.cpp:282-290`, `RGE_Action_Attack::update` [L]). So turning
  ally stops an attack under way.
- Right-click tasks, `RGE_Task_List::check_task` [M] owner types
  (`src/task_lst.cpp:186-226`): 2 is another non-Gaia player whose stance is
  not ALLY (attack); 4 is its own or a mutual ally's object; 5 is not its own,
  not an ally, and Gaia only when `combat_level > 0`. An attack order on an
  ally's unit therefore finds no task.
- Repair: allowed on its own or an ally's object, one-sided `isAlly`
  (`src/ttsk_lst.cpp:82-92`, `src/tact_rep.cpp:188`).

## 3. Allied line of sight (Writing)

Writing (tech 114, effect 113) adds 1 to attribute 50
`PLAYER_ATTRIBUTE_ALLIED_LOS` (effect type 1, mode add, `src/effects.cpp:183-193`).
`TRIBE_Player::add_attribute_num` [M] then sets `allied_LOS_Enable = 1` and
calls `update_mutual_allies` (`src/tplayer.cpp:3664-3668`; a scenario load does
the same, `:3988-3993`).

`RGE_Game_World::update_mutual_allies` [M] (`src/world.cpp:3214-3260`) gives
each player a visible mask and an explored mask: its own bit, plus, when its
own allied LOS is on, the bit of every player it is **mutually** allied with
(both stances ALLY). The map-cell tests read the masks: `get_visible`
(`src/visible.cpp:256-263`) and `visibleStatus` (`src/aiuaimod.cpp:2405-2415`).
The visible-unit lists stay per player (own bits only), so the unit AI does not
search an ally's sight. Callers: the relation command (`src/tcommand.cpp:374`),
game creation (`src/tribegam.cpp:3021`), Writing.

So a player with Writing and a mutual ally sees and has explored what the ally
sees and has explored; the ally sees nothing extra unless it has Writing too. A
one-sided alliance shares nothing, and breaking the alliance takes the shared
view away (the cells fall back to the player's own bits).

Port: `Visibility.mutualVisible`/`mutualExplored` hold the masks,
`World.tileVisibility` reads them, and they are hashed and in the snapshot. The
non-mutual masks (`nonMutualVisibleMask`, `RemoveVisibleBits`,
`:3214-3260`) only steer how fogged buildings are drawn and are not kept.

## 4. Commands

Both are TRIBE game command 0x67 (`TRIBE_Command::do_command_game`,
`src/tcommand.cpp:365-375`), built by `command_relation` and
`command_allied_victory` [M] (`:743-772`):

- RELATION (subcommand 0): `players[var1]->set_relation(var2, var3)`, a
  `GAME_NOTIFY_DIPLOMACY_CHANGED` notification (UI), `update_mutual_allies`.
- ALLIED_VICTORY (subcommand 5): `players[var1]->set_allied_victory(var2)`.

The Diplomacy dialog (`TribeDiplomacyDialog::action` [L],
`src/dlg_dip.cpp:418-500`) sends them for the local player only, for the rows
it enables: another player who is still playing, while the game is not over
(`:124-131`).

Port records (sim `commands.ts`, relayed as they are by `packages/protocol`):

| command | fields | id in the hash |
| --- | --- | --- |
| `relation` | `player` 0-8, `relation` 0, 1 or 3 | 13 |
| `allied-victory` | `on` boolean | 14 |
| `tribute` | `player` 0-8, `resource` 0-3, `amount` finite, > 0 | 15 |

The sender is always the player the batch comes from: a player changes only its
own stance and flag, and sends only its own resources (the anti-cheat rule of
PROJECT.md, 2026-11-15). The sim enforces the dialog's conditions: a relation or
tribute aimed at itself, Gaia, a player not in the game or one no longer
playing (`game_status != 0`) is ignored.

## 5. Tribute

Command GIVE_ATTRIBUTE 0x6C (struct `include/tcommand.h:126-135`,
`TRIBE_Player::command_give_attribute` [M] `src/tplayer.cpp:977-982`, which
sends nothing for an amount of 0), executed by `do_command_give_attribute` [M]
(`src/tcommand.cpp:453-486`), in floats:

```
amount < 0 -> 0;  cost = attr_cost * amount
if amount + cost > stock:  cost = stock * attr_cost;  amount = stock - cost
receiver[attr] += amount
sender[attr]   -= amount + cost
sender[53]     += amount + cost      (PLAYER_ATTRIBUTE_TRIBUTE_SENT)
receiver[53]   -= amount
```

then `GAME_NOTIFY_TRIBUTE_PAID` (`:482`; the chat line, `src/tribegam.cpp:1857`,
UI only). The fee is lost, not paid to anyone. With too little in stock the
whole stock goes: the fee's share of it is lost, the receiver gets the rest.

- Resources: food 0, wood 1, stone 2, gold 3, the dialog's four rows
  (`src/dlg_dip.cpp:457-482`, `check_food`/`check_wood`/`check_stone`/
  `check_gold` [M]).
- Fee `attr_cost`: attribute 46 `PLAYER_ATTRIBUTE_TRIBUTE_FEE`, 0.25 in every
  civ's starting attributes (`empires.dat`); Coinage (tech 30, effect 30) sets
  it to 0. The dialog shows it as a percent (`g_diplomacy_attribute_percent_scale`
  100, `src/game_globals.cpp:216`) and sends its value in the command.
- Market: the dialog enables tribute only while the player has an active Market
  (master 0x54 = 84, `src/dlg_dip.cpp:302-320`). The command itself does not
  check it.
- Dialog amounts: each click adds 100, when 100 plus its fee is in stock, else
  what is left (`src/dlg_dip.cpp:556-680`). The command takes any amount.

Port (`diplomacy.ts` `giveAttribute`): the same float steps (`num.ts`
`add32`/`mul32`/`sub32`); the fee is the sender's attribute 46 when the command
runs, not a number carried in the command, and the command is ignored when the
sender has no active Market. Both keep a modified client from paying a smaller
fee or skipping the Market (anti-cheat). Examples (fee 0.25): 1000 food, send
100 → sender 875, receiver +100, attribute 53 +125 / −100; Coinage: sender 900;
100 food, send 500 → sender 0, receiver +75; 90 wood, send 500 → receiver +67.5.

## 6. Allied victory

A player's team, when its own allied victory is on, is the players it is
mutually allied with and that have allied victory on; without it, itself only.

- `win_game_now` [M] (`src/player.cpp:1037-1052`): the player wins; when it has
  allied victory, every mutual ally with allied victory wins too; the others
  lose.
- `check_victory_conditions` (`:1054`), `check_ally_group` [D] (`:1061-1088`),
  `check_victory` [M] (`:1090-1118`): with allied victory on, a player whose own
  conditions are met wins only when every ally of its group has met its own too.
- `RGE_Game_World::check_game_state` [M] (`src/world.cpp:1377-1420`): the game
  ends (conquest) when the players still playing are one team: every other one
  has allied victory and a mutual alliance with the candidate (`:1392-1394`; the
  candidate's own flag is not read).
- Time limit: the team score adds the scores of mutual allies with allied
  victory (`src/tworld.cpp:923-950`). Relics and ruins: a team holding all of
  them counts (`:966-994`). Score victory: `handle_victory_points`
  (`src/victory.cpp:761-790`).

Port: `victory.ts` `teammates`, `winGameNow`, `checkVictory`,
`checkAllyGroup`, `checkGameState`; the world passes `World.diplomacy`.

## 7. Port status

Ported, with tests in `diplomacy.test.ts`: §1-§6. Client read API:
`World.relation(p, q)`, `isAlly`, `isEnemy`, `World.diplomacy`
(`alliedVictory`, `alliedLos`), `World.tileVisibility` (shared sight),
attributes 46 and 53. The chat's Allies/Enemies targets read `isAlly`/`isEnemy`
(chat.md §4).

Not ported:

- The Diplomacy dialog and the notifications (diplomacy changed, tribute paid):
  client UI, a later ship.
- Lobby teams and their starting alliances (`src/world.cpp:1013-1029`).
- The non-mutual visibility masks (drawing of fogged buildings).
- Priest conversion's stance checks: the sim has no Priests.
- Gaia searching its own objects: the original's bucket is SELF; the port keeps
  them in the GAIA bucket, as before this change.
