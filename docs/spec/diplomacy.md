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

## 7. The Diplomacy dialog and the notifications

### 7.1 Opening it

The top strip's Diplomacy button (`button_panel[13]`, `TRIBE_UI_COMMAND_DIPLOMACY`,
`src/scr_game.cpp:243`) runs `command_diplomacy` (`:3855-3862`): when the game is
not paused, a new `TribeDiplomacyDialog` (single player also pauses). There is no
hotkey: `key_down_action` (`:1451-1780`) has no Diplomacy key. The dialog is
modal; Esc is Cancel.

### 7.2 Layout (`TribeDiplomacyDialog::TribeDiplomacyDialog`, `src/dlg_dip.cpp:16-345`)

625 x 405, in the game screen's popup look (`dlg6_<culture>`, the Send Messages
dialog's). Texts are `create_text(x, y, w, h, font, horz_center, vert_center, wrap)`;
strings from language.dll (`include/resource_ids.h:144-162`):

| item | string | box | notes |
| --- | --- | --- | --- |
| title | 9851 "Diplomacy" | 72, 5, 500 x 30 | Copperplate 21, centred |
| headers | 9862 Name, 9852 Civilization, 9853 Ally, 9854 Neutral, 9855 Enemy | x 5 / 137 / 235 / 290 / 360, y 50 | standard font, left, centred top to bottom |
| fee | 9856 "Pay Tribute (cost %d%%)" with `(long)(attr 46 * 100)` (`g_diplomacy_attribute_percent_scale`, `src/game_globals.cpp:216`) | 440, 50, 180 x 30 | |
| no Market | 9863 "You need a Market to pay tribute." | 440, 110, 175 x 60 | centred, word-wrapped |
| Allied Victory | 9857 | 318, 330, 300 x 30 | check box at (282, 327) |
| OK, Clear Tributes, Cancel | 4001, 9859, 4002 | (10 / 215 / 420, 367), 190 x 30 | Copperplate 12; Cancel's hotkey Esc |
| help | 4009 "?" | 500, 327, 30 x 30 | `setup_popup_help` |

A row per player 1 .. n-1, row = player - 1, y = 80 + 30 * row (`:123-234`):
`dlg_plbn.shp` (0xC63A) at (10, y) in the player's colour (`draw`, `:832-859`);
the name (5, y, 130 x 30), struck out (`RGE_FONT_STRIKEOUT`) when the player is
defeated (`game_status` 2) or not a human or computer any more (`:133-150`); the
civilization (137, y, 100 x 30). For every other player three radio buttons
(`btn6` frames 4 / 6) at x 240, 310, 380, set from this player's own stance
(Ally, Neutral, else Enemy). For another player still playing, outside the game
over mode, four tribute buttons 40 x 30: wood 440, food 480, gold 520, stone 560,
`tradicon.shp` (0xC62C) frames 0, 2, 3, 1, picture and amount text. On this
player's own row the same four columns show its stock less the amounts chosen
(`:277-300`).

- Market (`:302-320`): with an active Market (master 0x54) the fee, the stock and
  the tribute buttons show and "You need a Market" hides; without one the
  reverse. Coinage researched (tech 30 state 3) hides the fee text (`:322-324`).
- `check_gold` .. `check_stone` (`:680-830`): a resource's buttons are disabled
  (two plain rectangles, no click) when the stock less the chosen total is 0 or
  less, and always on this player's row and in the game over mode.
- Game over mode: radio buttons and check box disabled, no OK or Clear Tributes.
- Focus starts on OK; tab order OK, Clear Tributes, Cancel (`:331-345`): Enter or
  Space presses the focused button (`TButtonPanel::key_down_action`,
  `src/pnl_btn.cpp:810-825`).

### 7.3 Behaviour (`TribeDiplomacyDialog::action`, `src/dlg_dip.cpp:418-678`)

- A tribute click (`:557-678`): `cost = max(fee, 0)`; when the resource is not
  exhausted, `cost += 1`; if `stock - total < cost * 100` the amount grows by
  `(stock - total) / cost` and the total by that times cost, else by 100 and
  `cost * 100`. The button shows `(long) amount`, the stock text
  `(long)(stock - total)`. Exhausted: the stock text shows what is left, at
  least 0. In floats. Example (fee 0.25, 1000 food): two clicks show 200 and
  750.
- OK (`:426-500`): the allied victory command when the check box changed, then
  per other player row the relation command when the radio changed, then that
  row's tributes in the order gold, wood, food, stone (each > 0); the dialog
  closes.
- Clear Tributes (`:516-555`): every amount and total back to 0, the buttons'
  texts empty, the stock texts the stock.
- Cancel (`:502-509`): closes, sends nothing.

### 7.4 Notifications (`TRIBE_Game::notification`, `src/tribegam.cpp:1857-1903`)

Each machine runs the notification as the command executes; only the target
player's screen shows it, on a chat line (`display_system_message`,
`src/scr_game.cpp:1408`):

- `GAME_NOTIFY_DIPLOMACY_CHANGED` (`src/tcommand.cpp:373`, val1 the sender, val2
  the target, val3 the stance): when val2 is this player, 3026 "%s changed
  diplomatic stance with you to Ally." (3025 Neutral, 3027 Enemy) with the
  sender's name. No sound. The sender sees nothing.
- `GAME_NOTIFY_TRIBUTE_PAID` (`src/tcommand.cpp:482`, val4 `(long)` the amount
  the receiver got, after the fee and a short stock): when val2 is this player,
  `play_sound(4)` (tribute.wav, interfac 50304) and 3016 food / 3015 wood / 3017
  stone / 3009 gold "%s paid %d food in tribute to you.". The sender sees
  nothing.

## 8. Port status

Ported, with tests in `diplomacy.test.ts`: §1-§6. Client read API:
`World.relation(p, q)`, `isAlly`, `isEnemy`, `World.diplomacy`
(`alliedVictory`, `alliedLos`), `World.tileVisibility` (shared sight),
attributes 46 and 53. The chat's Allies/Enemies targets read `isAlly`/`isEnemy`
(chat.md §4).

§7, client: `apps/client/src/hud/diplomacy.ts` `DiplomacyDialog` (opened by the
top strip's Diplomacy button in `hud/game-hud.ts`; test ids `diplomacy`,
`diplomacy-<ally|neutral|enemy>-<p>`, `diplomacy-tribute-<resource>-<p>`,
`diplomacy-stock-<resource>`, `diplomacy-allied-victory`, `diplomacy-ok` ...)
and `diplomacyNotices` (unit tests `diplomacy.test.ts` in the client). The sim
has no notification events, so the client reads the notifications off the
commands themselves: `Lockstep.onCommands` hands each turn's batches over just
before the step that runs them, and `diplomacyNotices` replays the stance,
tribute and resign commands in the sim's order (by player, then as issued) with
the sim's guards and `giveAttribute` over a copy of the attributes, for the
amount received. Known gap: another command earlier in the same step that
spends or refunds the sender's resource (a train, a building, a cancel) is not
replayed, so with a stock that runs short the amount shown can differ from what
the sim gave. e2e: `e2e/tests/diplomacy.spec.ts` (two players by invite code),
`e2e/real/real-diplomacy.spec.ts` (the real art and strings, screenshots
`diplomacy-no-market.png`, `diplomacy-tribute.png`, `diplomacy-notices.png`).

Not ported:

- The help button (`setup_popup_help`): shown disabled, as the menu's Help.
- Single player's pause while the dialog is open (multiplayer only here).
- Lobby teams and their starting alliances (`src/world.cpp:1013-1029`).
- The non-mutual visibility masks (drawing of fogged buildings).
- Priest conversion's stance checks: the sim has no Priests.
- Gaia searching its own objects: the original's bucket is SELF; the port keeps
  them in the GAIA bucket, as before this change.
