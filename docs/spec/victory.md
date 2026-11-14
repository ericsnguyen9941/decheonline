# Victory conditions and score

Source: aoe1-decomp @ `6d6d8b1` (July 1998 RoR beta; see `README.md` for the
version caveat and reference format). Status letters: M matching,
D accepted_drift, L accepted_logic, N nonmatching, read from
`config/functions/src/<file>.cpp.json` in the clone. Numeric types and the
float-store assumption follow `core.md` §3; the RNG is `core.md` §4; the
world step and its order are `core.md` §1.2.

Two functions that carry most of this spec are **L** (not byte-proven):
`TRIBE_World::new_game` (sets the victory type, rolls relics/ruins, builds
the score table) and `TRIBE_World::check_game_state` (time limit, relic and
ruin holds). `INDEX.md` lists the second as M; the clone's config says
`accepted_logic`. Everything resting on them is the decomp author's logic
reading.

## 1. Functions and status

| function | ref | status | role |
| --- | --- | --- | --- |
| `RGE_Victory_Conditions` ctor (new) | `src/victory.cpp:159` | M | empty lists, `victory = 0` |
| `RGE_Victory_Conditions::update` | `src/victory.cpp:320` | M | per step: points, conditions, verdict |
| `RGE_Victory_Conditions::check_for_victory` | `src/victory.cpp:250` | **D** | group verdict |
| `RGE_Victory_Conditions::handle_point_condition` | `src/victory.cpp:351` | M | dispatch on point command 0–4 |
| `RGE_Victory_Conditions::handle_condition` | `src/victory.cpp:371` | M | dispatch on condition command |
| `handle_points_attribute_amount` | `src/victory.cpp:1206` | **D** | score: per-unit points |
| `handle_points_attribute_first` | `src/victory.cpp:1222` | M | score: first to reach |
| `handle_points_highest_attribute` | `src/victory.cpp:1257` | **D** | score: current leader |
| `handle_points_high_attribute_once` | `src/victory.cpp:1294` | M | score: all-time leader |
| `handle_points_high_attribute_amount` | `src/victory.cpp:1326` | M | score: all-time own max |
| `get_victory_points` / `_group` / `_id` | `src/victory.cpp:1341`, `:1345`, `:1356` | M | totals for UI and time limit |
| `handle_victory_points` | `src/victory.cpp:761` | M | "reach N points" condition |
| `handle_capture` / `handle_destroy_all` | `src/victory.cpp:412`, `:583` | **D** / **N** | scenario conditions |
| other `handle_*` (create, destroy, bring, attribute, explore) | `src/victory.cpp:442`–`:726` | M | scenario conditions |
| `TRIBE_Victory_Conditions::handle_condition`, `handle_tech` | `src/tvictory.cpp:17`, `:25` | M | adds command `'d'` (100): tech researched |
| `RGE_Player::update` | `src/player.cpp:870` | M | runs `victory_conditions->update` |
| `RGE_Player::set_game_status` | `src/player.cpp:255` | M | 0 playing, 1 won, 2 lost |
| `RGE_Player::do_resign` | `src/player.cpp:267` | M | resign → lost |
| `RGE_Player::victory_if_game_on` / `loss_if_game_on` | `src/player.cpp:1025`, `:1031` | M | only from status 0 |
| `RGE_Player::win_game_now` | `src/player.cpp:1037` | M | winner + allied team win, rest lose |
| `RGE_Player::check_victory_conditions` | `src/player.cpp:1054` | M | |
| `RGE_Player::check_ally_group` | `src/player.cpp:1061` | **D** | allied-victory team consistency |
| `RGE_Player::check_victory` | `src/player.cpp:1090` | M | conditions met → won |
| `RGE_Game_World::check_game_state` | `src/world.cpp:1377` | M | end-of-game resolution |
| `TRIBE_World::check_game_state` | `src/tworld.cpp:923` | **L** | time limit, relics, ruins |
| `TRIBE_World::new_game` | `src/tworld.cpp:394` | **L** | victory type, relic/ruin roll, score table |
| `TRIBE_Player::update` | `src/tplayer.cpp:352` | M | per-second stats and elimination |
| `TRIBE_Action_Wonder::set_state` / `update` | `src/tact_wnd.cpp:98`, `:156` | M / M | wonder countdown |
| `RGE_Base_Game::set_countdown_timer` | `src/basegame.cpp:3873` | M | UI countdown (display only) |
| `T_Scenario::Save_victory_conditions_into_players` | `src/tscenaro.cpp:580` | M | rebuilds condition lists |
| `TRIBE_Combat_Object::damage` | `src/t_c_obj.cpp:212` | M | kill counter |
| `TRIBE_Building_Object::damage` | `src/t_b_obj.cpp:771` | M | razing counter |
| `RGE_Visible_Map::percentExplored` | `src/visible.cpp:355` | M | explored fraction |

## 2. Game settings → victory type

Lobby setting `TRIBE_Game::VictoryType` (`include/tribegam.h:121`; ruins,
artifacts, discoveries, exploration, gold are 3, 4, 5, 2, 6 at
`include/tribegam.h:42-46`) is turned into `TRIBE_World::victory_type`
(`include/tworld.h:78`) by `TRIBE_World::new_game` (`src/tworld.cpp:572-650`, L):

| lobby setting | `victory_type` | conquest flag | extra |
| --- | --- | --- | --- |
| Default or Standard (random map, non-campaign) | 0 | on | wonder, all-relics, all-ruins wins active |
| Conquest | 1 | on | none |
| Time limit (amount = years) | 2 | on | `countdown_victory = 1`, `countdown_clock = amount` (`src/tworld.cpp:622-626`) |
| Score (amount = points) | 3 | on | every player gets an "average team points ≥ amount" condition, group 0, ally flag 1 (`src/tworld.cpp:627-631`) |
| ruins / artifacts / discoveries / exploration / gold | stays 4 | off | scenario MP conditions (§7) |

- The table applies when the game is a random map and not a campaign, or the
  lobby setting is not Default (`src/tworld.cpp:577-578`). Scenario and
  campaign games with Default read the scenario's MP victory instead
  (`src/tworld.cpp:632-650`).
- "Conquest flag on" is `T_Scenario::Set_Multi_Conquest(1)`, which sets the
  scenario's conquest victory (`src/tscenaro.cpp:350-353`) read by
  `RGE_Scenario::Get_conquest_victory` (`src/scenario.cpp:955`).
- `Save_victory_conditions_into_players(0)` (`src/tworld.cpp:621`) first
  empties every player's condition list (`src/tscenaro.cpp:587-590`). For
  Standard, Conquest, Time and Score no MP condition is added, so the
  condition list is empty except the Score entry; per-player scenario
  conditions (`sp_victory`) are also added there (`src/tscenaro.cpp:640-721`)
  but random maps have none (inferred: a random map has no scenario
  objectives; unverified).
- Lobby amounts offered: time limit 15000, 13000, 11000, 9000, 7000, 5000,
  3000 (`src/scr_set.cpp:104-110`); score 3000 down to 300 (`src/scr_set.cpp:119-132`,
  steps of 300 then 100 below 900). `beta-only?`: retail menus may differ.

## 3. Relics and ruins at game start (RNG)

In `TRIBE_World::new_game`, for a random-map non-campaign game
(`src/tworld.cpp:727-737`, L), before `generator->generate()`:

1. Relics: if `victory_type == 3` (Score) the relics are placed **without**
   drawing a random number (the `||` short-circuits); otherwise draw
   `r1 = rand()` and place them if `r1 % 100 < 50`. Placing means
   `add_quick_obj(159, 5, map_width / 5)` and `artifact_count = 5`.
2. Ruins: always draw `r2 = rand()`; if `r2 % 100 < 50`,
   `add_quick_obj(158, 5, map_width / 5)` and `ruin_count = 5`.

So the RNG calls here are, in order: one `rand()` for relics (skipped in
Score games), then one for ruins. They sit after the earlier
`add_quick_obj` calls for MP relic/discovery/ruin conditions
(`src/tworld.cpp:652-725`, which draw nothing themselves) and before the
object generator runs (its draws, and the per-object `rand()`/`srand(r)` of
object creation, belong to the random-map spec). Scenario/campaign games
instead **count** the relics (unit 159) and ruins (units 158, 163) already
present (`src/tworld.cpp:738-770`), no RNG.

`rand` is the static VC5 CRT routine (`core.md` §4); `% 100` on its
0..32767 result.

**No other RNG.** None of `src/victory.cpp`, `src/tvictory.cpp`,
`src/tact_wnd.cpp`, `TRIBE_World::check_game_state`
(`src/tworld.cpp:923-1079`) or `RGE_Game_World::check_game_state`
(`src/world.cpp:1377-1430`) calls `rand`/`debug_rand` (checked with grep
over those ranges). Victory and score evaluation consume no random numbers.

## 4. Order of operations inside one world step

From `core.md` §1.2 step 7, with the victory parts expanded:

1. Commands for this turn run (resign is a command: `src/Command.cpp:679-682`
   → `RGE_Player::do_resign` → status 2).
2. For each player index 0..`player_num-1` in order,
   `TRIBE_Player::update` (`src/tplayer.cpp:352`, M):
   1. `update_time += world_time_delta_seconds`; **while** `update_time > 1.0`
      (strictly), subtract 1.0 and run the per-second block
      (`src/tplayer.cpp:353-396`):
      - attribute 22 (% explored) = 100 with full visibility, else
        `percentExplored() * 100` (`src/tplayer.cpp:364-367`);
      - attribute 44 (kills − losses) = attr 20 − (attr 19 − attr 11), clamped
        to ≥ 0 (`src/tplayer.cpp:368-372`);
      - **elimination check** (§6), players with id > 0 only
        (`src/tplayer.cpp:380-396`).
   2. `RGE_Player::update` (`src/player.cpp:870`): object list update (units
      act, die, finish buildings; wonder action runs here, §8), then
      `victory_conditions->update()`; if it returns 1, status ← 2 (lost)
      (`src/player.cpp:880-882`).
   3. Food maintenance and AI (not victory).
3. RNG fence for doppelgangers (`core.md` §1.2 step 7.5).
4. `TRIBE_World::check_game_state` (`src/tworld.cpp:923`, L). Only when
   `game_state == 0`:
   1. time-limit countdown (§9);
   2. if `artifact_count > 0 || ruin_count > 0`: build teams, then relic
      hold (§10), then ruin hold;
   3. then always `RGE_Game_World::check_game_state` (§5).

Inside `RGE_Victory_Conditions::update` (`src/victory.cpp:320-337`): every
point entry whose state is not 1 or 3 is evaluated, list order; then every
condition entry whose state is not 1 or 3; then `check_for_victory`.
Lists are built by prepending (`src/victory.cpp:793-805`, `:1101-1117`), so
evaluation runs in **reverse insertion order** (score ID 23 first, ID 0 last).
The total is a sum of integer deltas, so the order changes nothing for score
itself; it matters only in that the Score condition (§7) reads this step's own
total but allies' totals from their last update (lower index: this step;
higher index: previous step).

Gaia (player 0) also runs `victory_conditions->update`, but its lists are
empty (score entries are added for `i ≥ 1` only, `src/tworld.cpp:870-902`).

## 5. End-of-game resolution: `RGE_Game_World::check_game_state`

`src/world.cpp:1377-1430`, M. Player `game_status`: 0 playing, 1 won, 2 lost
(`src/player.cpp:1025-1035`). The decomp's local counter names do not match
these meanings; described here by meaning.

For each player `i = 1..player_num-1`, call `check_victory()`
(`src/player.cpp:1090`, M): if status ≠ 2 and the player's condition
verdict is "achieved" (`victory == 2`), then:
- without allied victory: status ← 1 and `game_end_condition = 2`;
- with allied victory: it is blocked (status unchanged) if the group check
  fails for self or any ally (`check_ally_group`, D: every ally must be
  mutual and have allied victory, and the members' counts must agree) or any
  ally that has not lost has not yet achieved its own conditions
  (`check_victory_conditions`, `src/player.cpp:1054`).

Then, counting the returned statuses:
- **won count > 0**: `game_state = 1` (game over) and every player still at
  status 0 gets status 2 (`src/world.cpp:1407-1410`).
- else if the conquest flag is on: let *candidate* be the first still-playing
  player in index order; the remaining still-playing players are *compatible*
  if each has allied victory and is mutually allied with the candidate
  (the candidate's own allied-victory flag is not checked). If (at least one
  player has status 2 **and** all still-playing players are compatible) **or**
  no player is still playing: `game_state = 1`, every still-playing player
  gets status 1, `game_end_condition = 1` (`src/world.cpp:1411-1417`).

Two-player consequence: as soon as one player reaches status 2 (eliminated,
resigned, or failed conditions), the other wins in the **same step's**
`check_game_state`.

`game_end_condition` codes (`src/tworld.cpp:1384-1412`, for the end screen):
1 conquest, 2 scenario conditions, 100 wonder, 101 all relics, 102 all ruins,
103 time limit, 104 cheat-win.

`set_game_status` (`src/player.cpp:255-265`): no-op if unchanged; a resigned
player can only move to 2. Status 1/2 are final in practice because
`victory_if_game_on` / `loss_if_game_on` act only from status 0.

`win_game_now` (`src/player.cpp:1037-1052`, M): the winner gets status 1 (if
playing); every other player `i ≥ 1` gets status 1 if the winner has allied
victory, the two are mutually allied and `i` has allied victory, else status
2 (if playing). `RGE_RELATION_ALLY` is 0 (`include/player.h:14`).

## 6. Elimination (conquest defeat)

`src/tplayer.cpp:380-396` (inside the per-second block, M). A player with
id > 0 is defeated (status ← 2, attribute 45 ← 0) when **no** object in its
object list is in state ACTIVE (2) with an object group other than:
11, 30 flag, 27 wall, 1 artifact, 21 fishing boat, 20 transport boat,
2 trade boat, 37 doppelganger (group values: `include/` `OBJECT_GROUP_*`;
group 11 has no name in the decomp).

- Foundations (state 0, UNBUILT) do not keep a player alive; any active
  building (houses included) or any other unit does.
- Evaluated only on whole-second ticks (§4), so a player whose last unit died
  is defeated at the first per-second tick after that, then the opponent wins
  in that step's `check_game_state` (§5).

## 7. Condition lists (scenario / special MP victories)

A condition entry has command, victory group, ally flag, state
(0 pending, 1 impossible, 2 met, 3 invalid), counters. Handlers
(`src/victory.cpp:371-410`, `src/tvictory.cpp:17-32`):

| cmd | meaning | met (state 2) when |
| --- | --- | --- |
| 0 capture | target object owned by self (or mutual ally with allied victory, if ally flag); target gone → 1 | `src/victory.cpp:412` (D) |
| 1 / 8 create (in area) | count of own ACTIVE objects of that unit id (+ allies' if ally flag and allied victory), inside the area for 8 ≥ number | `:442`, `:486` |
| 2 destroy object | target in state 7 (pending removal) | `:536` |
| 3 destroy N of type | adds, every evaluation while state 0, the number of matching objects in state 7 of the target player (or of every non-ally player) | `:543` |
| 9 destroy all of type | no object of that type left with target player / all non-allied players | `:583` (N) |
| 10 destroy player | target player status 2 | `:619` |
| 4 / 5 bring to area / to object | object inside area, or within (sum of both radii + 1) on each axis | `:628`, `:652` |
| 6 attribute | own attribute (+ allies' if ally flag and allied victory) ≥ count, float compare | `:686` |
| 7 explore | `percentExplored()*100 ≥ count` for self (or any ally with ally flag) | `:726`; count clamped 1..100 at `:929` |
| 12 victory points | `(own total + allied totals) / players` (C integer division) ≥ count | `:761` |
| 100 (`'d'`) tech | tech state 3 (researched) | `src/tvictory.cpp:25` |

`check_for_victory` (`src/victory.cpp:250-318`, D), only if the list is not
empty: groups are visited in list order of their first entry. A group that
contains any entry in state 1 counts as *failed*. A group in which at least
one entry is 2 and every entry is 2 or 3 makes `victory = 2` (achieved) and
stops. If every group visited failed, `victory = 1`, and `RGE_Player::update`
turns that into a loss. Quirk (inferred from the code, D status): the count
of state-3 entries is **not reset between groups**, so a state-3 entry in an
earlier group can let a later group pass with fewer met entries.

MP special conditions (`src/tscenaro.cpp:592-638`): exploration →
cmd 7; ruins → attribute 14 ≥ n; artifacts → attribute 7 ≥ n; discoveries →
attribute 13 ≥ n (no ally flag); gold → attribute 3 ≥ n. With
`victory_all_flag` they all share group 8 (all needed); without it each has its
own group 8–12 (any one wins). These are the "ruins/artifacts/…" lobby types
of §2; they are not reachable from the Standard/Conquest/Time/Score options.

`update_for_object` (`src/victory.cpp:339`): when an object is destroyed
or recycled while not yet pending removal (`src/stat_obj.cpp:60-71`,
`:183-190`), every condition referring to it is removed from the list.

## 8. Wonder victory

The Wonder (unit 276) runs a `TRIBE_Action_Wonder` (action type 120,
`include/action.h:25`; created by the action-list factory,
`src/tact_lst.cpp:83-84`; which data/task attaches it to the Wonder is not
traced — unverified). Constant `LIMIT = 2000.0f` (`src/tact_wnd.cpp:15`).

- State 2 (`src/tact_wnd.cpp:129-148`), entered on first push
  (`:92-96`): reveals the site to every other player and notifies "wonder
  started". Each update in state 2: once the object is ACTIVE (construction
  finished), switch to state 6 and return **without** advancing the timer
  (`:181-186`).
- Entering state 6 (`:102-127`): re-reveals for others, notifies "wonder
  completed"; if standard victory, sets the on-screen countdown to 2000.
- Each update in state 6 (`:158-179`): if `timer ≥ 2000` do nothing; else
  `timer = (dt + dt) + timer` with `dt = world_time_delta_seconds` (float);
  if not standard victory, stop here; else set the countdown display to
  `(int)(2000 − timer)` and, if `timer ≥ 2000`, `owner->win_game_now()` and
  `game_end_condition = 100`.
- "Standard victory" here is the decomp expression
  `rge_base_game->world[1].world_time == 0`. Inferred: `sizeof(RGE_Game_World)`
  is 0x104 (`include/world.h:195`) and `world_time` is its first field after
  the vtable (+4), so this reads offset 0x108 of the `TRIBE_World`, which is
  `victory_type` (`include/tworld.h:78`). So the wonder wins only when
  `victory_type == 0`, but its timer runs in every mode.
- The timer belongs to the action; destroying the wonder destroys it (the
  destructor only un-reveals, `src/tact_wnd.cpp:26-89`). A new wonder starts
  from 0.
- The win happens inside the owner's `objects->update`, so later players
  in the same step already see final statuses, and that step's
  `check_game_state` ends the game (§5).
- Attribute 42 (standing wonders) comes from the Wonder's resource storage
  (type 42, amount 1, flag 4 in the captain's `empires.dat`, all civs),
  given when construction completes and taken when an active wonder starts
  dying or changes owner (`src/t_b_obj.cpp:190-205`, `:247-248`, `:303-304`).

The countdown is in "years": the timer runs at 2 per game second, so 2000
years is ~1000 s of game time. See §12 for the exact float step count.

## 9. Time-limit victory

`src/tworld.cpp:926-962` (L). While `victory_type == 2`,
`countdown_victory ≠ 0` and `countdown_clock ≥ 1.0`:
`countdown_clock −= dt * 2.0`. When it drops below 1.0 (once):

1. For each player `i ≥ 1`: team score = own `get_victory_points()`; if
   the player has allied victory, add the points of every `j ≥ 1`, `j ≠ i`,
   mutually allied with allied victory; divide by the member count (C integer
   division, truncation).
2. The winner is the player with the **strictly** highest team score, scanned
   from index 1 upward (initial best −1): ties go to the **lowest index**.
3. `win_game_now()` on that player (§5), `game_end_condition = 103`.

Defeated players are not skipped. Inferred consequence (unverified in play):
if the top team score belongs to an already-defeated player,
`win_game_now` cannot give it status 1, everyone else is set to lost, and
the game ends with no winner. With two players this cannot happen, because
the first defeat already ended the game.

## 10. All relics / all ruins

`src/tworld.cpp:965-1075` (L), each step while `game_state == 0` and
`artifact_count > 0` or `ruin_count > 0`.

Teams: players 1.. in index order; an unassigned player opens a new team; if
it has allied victory, every still-unassigned `j` with allied victory and
mutual alliance joins it (`src/tworld.cpp:974-994`).

Per team, relics (ruins identical with attribute 14 / 54, `ruin_held_time`,
code 102):
- team total of attribute 7 (relics held, int-truncated per player)
  `== artifact_count`:
  - if the first member's `artifact_held_time == −1` (not armed): attribute
    55 ← 1 for all members; if `victory_type == 0`, held time ← 2000 for all
    members and notify.
  - else if held time ≥ 1 and `victory_type == 0`: held −= `dt * 2.0`,
    copied to all members; if it is now < 1: first member `win_game_now()`,
    `game_end_condition = 101`.
- else if the first member's held time ≠ −1: attribute 55 ← 0 for all; if
  `victory_type == 0`, held time ← −1 and notify "lost".

Quirks: outside Standard the held time stays −1, so attribute 55 (and its 50
score points) is re-set to 1 every step but never cleared when the relics are
lost (the clearing branch requires held time ≠ −1). Inferred from the code;
unverified in play. Equality is exact: holding more relics than
`artifact_count` (scenario extras) never arms the timer. Arming happens the
step the team completes the set; the first decrement is the next step.

Attributes 7 and 14 are fed by the relic (units 108 War Chest, 159) and ruin
(units 158, 163) resource storages: type 7/14, amount 1, flag 2 in the
captain's dat (given on gain, taken on loss).

## 11. Score

**Location (pinned):** the score is the per-player victory-point list built in
`TRIBE_World::new_game` (`src/tworld.cpp:874-901`, L), evaluated every step
by `RGE_Victory_Conditions::update` (§4). Displayed groups
(`src/scr_ach.cpp:445-466`): 0 Military, 1 Economy, 2 Religion,
3 Technology, then "Survival" = ID 22 > 0, "Wonder" = ID 23 > 0, and Total =
`tot_victory_points` (sum of every entry's current points, IDs 22/23
included). Group names are from the achievements screen string ids
(inferred labels).

Added only on the normal path (not with the `nofoodcap`/`system2`
developer arguments, `src/tworld.cpp:857-869`); ID 8 only without full
visibility (`src/tworld.cpp:885-887`). At the same place attribute 45 ←
1.0 (`src/tworld.cpp:875`).

### 11.1 Entry kinds (A = player attribute, `n` = amount, `P` = points)

- **amount** (cmd 0, `src/victory.cpp:1206`, D): `v = trunc(A)` as int32;
  `k = v / n` (C division, toward zero), then `k ← max(k, 0)`;
  points `= P · k`.
- **first** (cmd 1, `:1222`, M): when `trunc(A) ≥ n`: if **any** other
  player index `0..player_num-1` (Gaia included) has `A ≥ n` (float compare)
  the entry becomes state 1 (never scores); else it scores `P` and becomes
  state 2 (kept forever). Checked in player-update order, so the earlier
  index wins a same-step tie only if the other has not reached it at that
  moment.
- **highest** (cmd 2, `:1257`, D): `v = trunc(A)`; if `v < n`: 0; else scan
  players `1..player_num-1` except self: any other `A > v` → 0 (stop); an
  equal one → keep the previous points; otherwise `P`.
  So a tie never takes points away from the holder and never gives them to
  the newcomer.
- **all-time leader** (cmd 3 `high_attribute_once`, `:1294`, M):
  own max `M ← max(M, trunc(A))` (initially 0); others' max
  `T ← A_j` for each other `j ≥ 1` in index order with `A_j ≥ T` (starts at
  `n`, truncated to int; so `T` is the all-time maximum of the others and
  never decreases).
  Points: `P` if `M ≥ T`, else (previous points if `trunc(A) == T`, else 0).
  Ties give both players `P`.
- **all-time own max** (cmd 4 `high_attribute_amount`, `:1326`, M):
  `M ← max(M, trunc(A))`; points `= trunc(M / n) · P`.

### 11.2 The score table (real values, `src/tworld.cpp:876-900`)

| ID | group | kind | attr | n | P | attribute meaning / source |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | 0 Mil | amount | 20 | 2 | 1 | kills: +1 to the attacker when a unit of a player > 0 drops below 1 HP on that hit (`src/t_c_obj.cpp:229-231`) |
| 1 | 0 Mil | amount | 43 | 1 | 1 | razings: +1 when a building of a player > 0 is below 1 HP after a hit (`src/t_b_obj.cpp:795-797`) |
| 2 | 0 Mil | amount | 44 | 1 | 1 | kills − losses, per second (§4) |
| 3 | 0 Mil | all-time leader | 40 | 1 | 25 | military count: +1 at creation of a non-priest combat unit or watch/guard/sentry tower, −1 at removal (`src/t_c_obj.cpp:78-87`, `:57-65`) |
| 4 | 1 Eco | amount | 49 | 100 | 1 | gold earned: gold added with the "earned" flag (`src/tplayer.cpp:3661-3664`) |
| 9 | 1 Eco | amount | 53 | 60 | 1 | tribute: sender + (amount + fee), receiver − amount (`src/tcommand.cpp:479-480`) |
| 5 | 1 Eco | all-time own max | 37 | 1 | 1 | civilian count (villagers, fishing and trade boats; same places as attr 40) |
| 6 | 1 Eco | all-time leader | 37 | 1 | 25 | " |
| 7 | 1 Eco | amount | 22 | 3 | 1 | % explored, per second |
| 8 | 1 Eco | highest | 22 | 1 | 25 | " (absent with full visibility) |
| 10 | 2 Rel | amount | 41 | 1 | 2 | conversions (`src/tact_cnv.cpp:325`, `:382`) |
| 11 | 2 Rel | highest | 41 | 1 | 25 | " |
| 12 | 2 Rel | amount | 14 | 1 | 10 | ruins held |
| 13 | 2 Rel | amount | 7 | 1 | 10 | relics held |
| 14 | 2 Rel | amount | 52 | 1 | 3 | temples: storage type 52, amount 1, **flag 1** on Temple1 (unit 104) in the captain's dat |
| 16 | 2 Rel | amount | 55 | 1 | 50 | all relics held (§10) |
| 15 | 2 Rel | amount | 54 | 1 | 50 | all ruins held (§10) |
| 17 | 3 Tech | amount | 21 | 1 | 2 | technologies researched |
| 18 | 3 Tech | highest | 21 | 1 | 50 | " |
| 19 | 3 Tech | first | 6 | 3 | 25 | current age; Stone/Tool/Bronze/Iron Age techs 100–103 set it to 1/2/3/4 (effects 94–97, set mode, captain's dat): first to **Bronze** |
| 20 | 3 Tech | first | 6 | 4 | 25 | first to **Iron** |
| 22 | 4 bonus | amount | 45 | 1 | 100 | survival: 1.0 from start, 0 on elimination (§6) |
| 23 | 4 bonus | amount | 42 | 1 | 100 | standing wonders (§8), 100 per wonder |

Notes:
- Resource-storage flags (`src/stat_obj.cpp:445-467`, D): flag 1 = given when
  the object is created, never taken back; flag 2 = given at creation and taken
  back on removal while not yet dying or on owner change; flag ≥ 4 = buildings,
  given on completion (§8). So, from the captain's dat, temples (flag 1) count
  from the moment the foundation exists and never decrease: inferred, not
  confirmed in play. Attr 19 (units ever, flag 1) and attr 11 (population,
  flag 2) on 86 unit types make ID 2's "losses" = units ever − current.
- The decomp annotates a bug (`src/t_c_obj.cpp:234-238`): conversion does not
  move the attr 37/40 counts, so the original owner stays +1 and the new owner
  gets nothing until the unit is deleted.
- Kills are counted by `TRIBE_Combat_Object::damage` only; buildings override
  `damage` and count razings instead, so destroying a building is not a kill.
- Attribute names for 42, 43, 45 and 52 are not in the decomp's `#define`s;
  meanings come from the score labels (`src/scr_ach.cpp`, `src/tplayer.cpp:3582`)
  and the dat storages above.
- Starting attributes in the captain's dat: every civ has attribute 6 = 0 and
  45 = 0; 45 is set to 1 by `new_game`.

## 12. Worked examples (test vectors)

All use the port's fixed step of 90 ms (`packages/sim/src/world.ts:8`), so
`dt = fround(90 * fround(0.001)) = 0.09000000357627869` and
`dt + dt = dt * 2 = 0.18000000715255737`, and float32 rounding after every
operation (`core.md` §3). Step counts were computed with `Math.fround`;
they differ from real-number arithmetic, which is the point of the vectors.

### Example 1: wonder countdown

Wonder finishes in step S (state 2 → 6, no increment). From step S+1 the
timer grows by 0.18 per step. After **11110** increments it is
2000.054931640625 ≥ 2000: the owner wins in step **S+11110**
(999.9 s of game time). Real-number arithmetic would give 11112. The first
display value is `(int)(2000 − 0.18) = 1999`.

### Example 2: all relics held

A team completes the 5 relics in step R: attribute 55 ← 1, held time ←
2000 (no decrement). From step R+1 held time −= 0.18 per step; after
**11105** decrements it is 0.8451457619667053 < 1: the team's first member
wins in step **R+11105**, `game_end_condition = 101`. Losing one relic in
any step in between resets held time to −1 and attribute 55 to 0.

### Example 3: time limit

| lobby years | decrements until < 1 | final clock | game seconds |
| --- | --- | --- | --- |
| 3000 | 16662 | 0.9323726296424866 | 1499.58 |
| 15000 | 83375 | 0.8523479104042053 | 7503.75 |

At that step: P1 total 333, P2 total 333 (no allied victory) → team scores
333, 333 → strict `>` scan → **P1 wins** (lower index). With allied victory
and P1+P3 a team (P1 = 333, P3 = 100) the team score is (433)/2 = 216.

### Example 4: score breakdown for one player

Two players, random map, Standard, no full visibility, 72×72 map. Player 1
state at the step evaluated (history in brackets):

| ID | input | points |
| --- | --- | --- |
| 0 | kills 7 → 7/2 = 3 | 3 |
| 1 | razings 2 | 2 |
| 2 | kills 7 − (units ever 30 − pop 20) = −3 → clamped 0 (attr 44 is already clamped) | 0 |
| 3 | max military ever 12 [P2 max 9] → M ≥ T | 25 |
| 4 | gold earned 450 → 450/100 = 4 | 4 |
| 9 | tribute attr 130 → 130/60 = 2 | 2 |
| 5 | max civilians ever 24 | 24 |
| 6 | 24 [P2 max 26, P1 now 24 ≠ 26] | 0 |
| 7 | explored 2469 of 5184 tiles: attr 22 = 47.627315521240234 (float32) → 47 → 47/3 = 15 | 15 |
| 8 | P2 explored 52 > 47 | 0 |
| 10 | conversions 3 | 6 |
| 11 | P2 conversions 1 < 3 | 25 |
| 12, 13 | ruins 0, relics 1 | 0 + 10 |
| 14 | temples 2 | 6 |
| 15, 16 | not all held | 0 + 0 |
| 17 | techs 18 | 36 |
| 18 | P2 techs 15 | 50 |
| 19 | reached Bronze before P2 | 25 |
| 20 | not Iron | 0 |
| 22 | not eliminated | 100 |
| 23 | no wonder | 0 |

Groups: Military 30, Economy 45, Religion 47, Technology 111; Total
**333** (= 30 + 45 + 47 + 111 + 100).

### Example 5: elimination timing

P2's last villager dies in step K while P2 owns only two walls and a fishing
boat. With `update_time` = 0.5 after step K−1, P2's next per-second ticks
happen when `update_time` exceeds 1.0. In float32: 0.5900000334,
0.6800000668, 0.7700001001, 0.8600001335, 0.9500001669, 1.0400002003 → in
step **K+6** P2 gets status 2 and attribute 45 = 0
(ID 22 → 0 points), and P1 wins in that step's `check_game_state` with
`game_end_condition = 1`. A pending foundation would not save P2; one
active house would.

From game start (`update_time = 0`) the per-second block runs in steps
**12, 23, 34, 45, 56** (float32 replay): 11 steps are 0.99 s, so the tick
drifts one step earlier every ~11 s of game time.

### Example 6: relic/ruin roll

Random-map Standard: relic roll `r1 = rand()`, `r1 % 100 = 37 < 50` →
5 relics, `artifact_count = 5`; ruin roll `r2 % 100 = 62` → no ruins,
`ruin_count = 0`. In a Score game the same seed gives relics without
consuming `r1`, so the ruin roll uses the value that was `r1` and every
later draw shifts by one.

## 13. Implications for the port

- Run victory/score inside the sim, in the order of §4: per-player update
  (per-second block with elimination before object update, then score and
  conditions after object update), then world check (time limit, relic, ruin
  holds, then status resolution). Both peers must reach game over in the
  same step; the step's state hash should include `game_status`, the score
  totals and the hold timers.
- Score is **sim state**, not UI: entries keep history (all-time maxima,
  "first" latches, highest-tie retention), so it must be updated every step,
  not computed on demand.
- Use float32 for timers (`timer`, `countdown_clock`, held times,
  `update_time`) and attributes; the examples in §12 depend on it. Integer
  math for points (trunc toward zero, C division).
- RNG: exactly the two game-start rolls of §3 (relic roll skipped in Score
  games); no RNG in any per-step victory code.
- Time limit and score amounts come from the lobby lists in §2; the room
  settings need victory type + amount, and allied-victory/diplomacy per player
  if teams are ever supported (two-player rooms make most ally paths dead
  code, but keep the formulas general).
- Wonder: one timer per wonder action, 2 per second, win only in Standard
  (`victory_type == 0`); keep that check even though the decomp spells it as
  an out-of-bounds read.
- Port the quirks (§7 group counter, §9 defeated top scorer, §10 attribute 55
  outside Standard, §11 temple flag 1 and conversion counts) as-is unless a
  retail recording shows otherwise; each is a candidate golden test.

## 14. Unverified / inferred points

- Everything from `TRIBE_World::new_game` and `TRIBE_World::check_game_state`
  (L): victory-type mapping, relic/ruin rolls, score table, time limit,
  relic/ruin holds.
- The wonder's standard-victory test is an offset inference (§8).
- How the Wonder unit gets its `TRIBE_Action_Wonder` (task data) is not traced.
- Random maps have no `sp_victory` conditions (§2).
- Retail 1.0a may differ in score weights or menu amounts (`beta-only?`);
  only the dat values were checked against the captain's files.
- Which gold counts as earned (attr 49) is `economy.md` §3.5 (gather deposit
  earns, hunt deposit does not) and `support-actions.md` (trade); not
  re-traced here.
- When flag-2 storages (population) are taken back on death is
  `economy.md` §6.3 and `combat.md`; not re-traced here.
- Razings: a building between 0 and 1 HP that is hit again (archers deal
  at least 0.1, `src/game_globals.cpp:319-320`) would count another razing
  each hit if it is still targetable; whether it can be is the combat spec's.
- x87 extended precision vs float32 store for the timers follows `core.md`
  §3's assumption; the step counts in §12 are only as good as it.
