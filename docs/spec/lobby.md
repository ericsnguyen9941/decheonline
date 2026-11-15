# Multiplayer game setup (lobby settings)

Source: aoe1-decomp @ `6d6d8b1` (July 1998 RoR beta; see `README.md` for the
version caveat and reference format). Status letters: M matching,
D accepted_drift, L accepted_logic, N nonmatching, from
`config/functions/src/<file>.cpp.json`. The random map these settings feed is
`random-maps.md`; the victory types are `victory.md` §2.

## 1. Functions and status

| function | file | status | role |
| --- | --- | --- | --- |
| `TribeMPSetupScreen::TribeMPSetupScreen` | `src/scr_mps.cpp:42` | L | the setup screen: player rows (name, civ, colour, team), the Settings button or summary, chat, ready, start |
| `TribeMPSetupScreen::init_vars` | `src/scr_mps.cpp:348` | M | multiplayer defaults (§2), each slot's random civ (§3) |
| `TribeMPSetupScreen::action` | `src/scr_mps.cpp:613` | L | ready, civ pick, Settings, Start |
| `TribeMPSetupScreen::handle_user_command` | `src/scr_mps.cpp:1209` | L | host takes a guest's civ from its readiness; open slots re-roll their civ |
| `TribeMPSetupScreen::fillPlayers` | `src/scr_mps.cpp:1478` | M | which row controls are live (§4) |
| `TribeMPSetupScreen::updateSummary` | `src/scr_mps.cpp:1718` | M | the settings summary lines (§7) |
| `TribeMPSetupScreen::startGame` | `src/scr_mps.cpp:848` | N | host only, every player ready |
| `TribeGameSettingsScreen::TribeGameSettingsScreen` | `src/scr_set.cpp:19` | M | the host's Game Settings dialog: every drop-down and check box (§2) |
| `TribeGameSettingsScreen::action` | `src/scr_set.cpp:487` | M | OK, Cancel; Time Limit / Score pick their default line |
| `TribeGameSettingsScreen::getSettings` / `sendSettings` | `src/scr_set.cpp:656`, `:712` | M | dialog ↔ game options |
| `TRIBE_Game::popLimit` | `src/tribegam.cpp:3736` | M | the Population Limit, 50 outside multiplayer (§2) |
| `TRIBE_Game::create_game` | `src/tribegam.cpp:2739` | L | resolves a Random civ from the game seed (§5); Reveal Map after `new_game` (§2.1) |
| `TRIBE_World::new_game` | `src/tworld.cpp:394` | L | the start settings after the objects: tech tree effect, resources, Death Match, age (§2.1) |
| `TRIBE_RMM_Database_Controller::add_object_module` | `src/rmm_tdbc.cpp:278` | L | Nomad's object rows (§2.1) |
| `TRIBE_Player::rev_tech` | `src/tplayer.cpp:1132` | M | the starting age's techs (§2.1) |
| `TRIBE_Player_Tech::rev_tech` / `do_rev_tech` / `enable` / `disable` | `src/tech.cpp:585`, `:570`, `:614`, `:600` | M | a tech with everything that requires it; tech states (§2.1) |
| `RGE_Visible_Map::explore_all` | `src/visible.cpp:331` | M | Reveal Map (§2.1) |

## 2. The host's settings (Game Settings dialog, `src/scr_set.cpp`)

Only the host has the **Settings** button (`STRING_ID_MP_SETTINGS_LABEL` 9682,
`scr_mps.cpp:204-210`); a guest gets the same label as a title over the
summary (§7). The button is disabled while the host is ready
(`scr_mps.cpp:684`). The dialog's controls, in the order the constructor
makes them, with the multiplayer defaults `init_vars` sets
(`scr_mps.cpp:431-452`):

| control | values (drop-down order) | MP default |
| --- | --- | --- |
| scenario list | "Random Map" (id −2), "Death Match" (−1), then each scenario file (`fillScenarios`, `scr_set.cpp:616-623`); `sendSettings` sets `deathMatch` for line −1 (`:721`); picking another line selects the victory drop-down's line 0 (`fillMissionText`, `:642-644`) | Random Map (`deathMatch` 0, `scr_mps.cpp:453`) |
| Map Size | Tiny 72, Small 96, Medium 120, Large 144, Huge 200, Humongous 250 (shown "Gigantic") | Large |
| Map Type | AllWater .. Isthmas, `TRIBE_Game::MapType` 0-8 (§7 names) | MostlyLand 3 |
| Victory Condition | random map: Standard (stored as `VictoryDefault` 0), Conquest 1, Time Limit 7, Score 8; a scenario adds Default 0 and Standard 9 | Default (Standard) |
| Time Limit (only for Time Limit) | 15000, 13000, 11000, 9000, 7000, 5000, 3000 years | line 3, 9000, when Time Limit is picked |
| Score (only for Score) | 3000, 2700, 2400, 2100, 1800, 1500, 1200, 900, 800, 700, 600, 500, 400, 300 | line 7, 900, when Score is picked |
| Starting Age | Default 0, Nomad 1, Stone 2, Tool 3, Bronze 4, Iron 5 (`TRIBE_Game::Age`, `scr_set.cpp:148-154`) | Default (`scr_mps.cpp:450`) |
| Resources | Default 0, Medium 2, High 3 (`TRIBE_Game::ResourceLevel`; Low 1 is not listed, `scr_set.cpp:162-165`); inactive (`activatePanels`, `:786-792`) and stored Default (`sendSettings`, `:746-750`) for Death Match | Default (`scr_mps.cpp:449`) |
| Path Finding | Default, Medium, High (MP: `mpPathFinding`) | Default (`basegame.cpp:101`) |
| Population Limit (MP only) | 25, 50, 75, 100, 125, 150, 175, 200 (`scr_set.cpp:181-194`, made only when `multiplayerGame()`) | 50 (`tribegam.cpp:198`, `:2230`) |
| Difficulty Level | Easiest .. Hardest (computer players) | single player's |
| Fixed Positions (check) | on = `randomizePositions` 0 | on |
| Full Tech Tree (check) | `scr_set.cpp:218-225`, stored `:744` | off (`scr_mps.cpp:448`) |
| Reveal Map (check) | `fullVisibility`, `scr_set.cpp:227-231`, stored `:742` | off (`scr_mps.cpp:442`) |
| Enable Cheating (check, MP only) | | off |

Also set by `init_vars` and not on the dialog: animals and predators on, fog
of war on, long combat off, trading on, starting units 0, quick start off,
8 players. `sendSettings` writes map size and type only for a random game;
the victory amount is the Time or Score line, else 1 (`scr_set.cpp:722-733`).
Picking Time Limit or Score in the victory drop-down sets the amount
drop-down to its line 3 or 7 (`scr_set.cpp:512-521`). The lobby enum maps to
the world's `victory_type` in `TRIBE_World::new_game` (`victory.md` §2):
Default/Standard → 0, Conquest → 1, Time → 2 with `countdown_clock` = years,
Score → 3 with the points condition.

Population Limit. `getSettings` selects the drop-down line of `popLimit()`
and `sendSettings` stores the picked line's id, the number itself
(`scr_set.cpp:701-703`, `:757-759`). `TRIBE_Game::popLimit` returns the
stored value in a multiplayer game and 50 otherwise (`tribegam.cpp:3736-3741`);
a command-line value is clamped to 25..200 (`tribegam.cpp:535-547`).
`TRIBE_World::new_game` gives every player but Gaia `attributes[32] =
popLimit()` after the start objects (`tworld.cpp:869-872`; the `nofoodcap`
and `system2` program arguments force 50 instead, `:857-867`), and nothing
changes it later: no tech or House touches attribute 32 (`economy.md` §6.4).
It caps training twice: a production queue does not start its next unit
while `population >= limit` (`t_b_obj.cpp:978-986`, "You have reached your
population limit.", 3046) and `check_obj_cost` refuses a headroom cost the
same way (`tplayer.cpp:1054-1059`); Houses past the limit still add headroom,
which nothing can use. The House's object panel row shows `population /
min(population + headroom, limit)` (`tpnl_obj.cpp:463-470`), as does the F11
population overlay (`tpnl_pop.cpp:155-160`). The setup screen's summary ends
with "Population Limit: %d" (`scr_mps.cpp:2069`, `:2543`).

### 2.1 The start settings at game start

`TRIBE_World::new_game` (`src/tworld.cpp:394`), after `RGE_Game_World::new_game`
has made the map and every start object, for each player but Gaia, in this
order:

1. **Full Tech Tree**: off, the civ's tech tree effect (`tribe_effect`, its
   disables and bonuses); on, effect 210 instead ("A01": one command, disable
   tech 118), so no civ bonus and no other disabled tech
   (`tworld.cpp:796-805`; help text 30263).
2. **Resources**: Default leaves the civ's own stockpile (food 200, wood 200,
   gold 0, stone 150 for every playable civ's table); Medium sets 500, 500, 0,
   250; High 1000, 1000, 0, 750 (food, wood, gold, stone;
   `tworld.cpp:806-831`; Low, 200, 200, 0, 100, is not on the dialog).
3. **Death Match**: 20000 food, 20000 wood, 10000 gold, 5000 stone
   (`tworld.cpp:833-840`), over the resource level (which the dialog keeps
   Default). The description string 9752 says "20,000 of each resource"; the
   code wins. Death Match is otherwise a Random Map game (map size and type
   apply); `deathMatch` is read elsewhere only by the computer player
   (`taimdmd.cpp:338`, `tplayer.cpp:71-`).
4. **Starting Age** (`tworld.cpp:842-855`): Default, Nomad and Stone do
   nothing here. Tool, Bronze, Iron call `TRIBE_Player::rev_tech` with the
   attribute holding the age's tech id (25 Tool, 23 Bronze, 24 Iron: 101, 102,
   103 in every civ) (`tplayer.cpp:1132-1168`):
   - Tool: `do_tech(Tool Age)` alone.
   - Bronze: `disable(Bronze)`, `rev_tech(Tool)`, `enable(Bronze)`,
     `do_tech(Bronze)`.
   - Iron: `disable(Bronze)`, `disable(Iron)`, `rev_tech(Tool)`,
     `enable(Bronze)`, `rev_tech(Bronze)`, `enable(Iron)`, `do_tech(Iron)`.

   `TRIBE_Player_Tech::rev_tech(t)` (`tech.cpp:585-598`) runs `do_tech(t)`,
   then for every tech id i in order and each of its 4 prerequisite slots
   naming t, `do_rev_tech(i)`: depth first, each prerequisite neither
   disabled nor done gets `do_rev_tech`, then `do_tech(i)`
   (`tech.cpp:570-582`). `do_tech` completes a tech that is not disabled or
   done, runs its effect and `check_for_new_tech` (`tech.cpp:267-282`), so
   zero-time techs the ages open complete too. `disable` sets any state but
   done to −1, `enable` a −1 back to 0 (`tech.cpp:600-626`). So a Bronze
   start has every tech that requires the Tool Age, with its other
   prerequisites, done, except those the civ disabled (step 1 came first) —
   the help text 30257: "Bronze Age indicates that all Stone Age and Tool
   Age technology has been completed". Techs requiring the later age itself
   stay to be researched, but for the zero-time ones `check_for_new_tech`
   completes. No cost is paid.

Then the population limit and the other new-game attributes (§2,
`tworld.cpp:857-872`).

**Nomad** changes the map generator's object table
(`TRIBE_RMM_Database_Controller::add_object_module`, `rmm_tdbc.cpp:284-293`,
after its discarded draw): every Villager (`MASTER_OBJECT_MAN`, 83) row gets
1 group, every Town Center (109) row 0 groups. Every dat random map's start
rows are a Town Center (1 group of 1) and Villagers (3 groups of 1), so a
Nomad player starts with 1 Villager and no Town Center, its stockpile as
Default. `random_start` then looks at the player's newest object
(`tplayer.cpp:1179-1240`), and a player without a Town Center may build one
(attribute 48, `hud.md`).

**Reveal Map** (`fullVisibility`): `TRIBE_Game::create_game`, right after
`world->new_game`, calls `explore_all` on every non-computer player's
visible map from player 1 up (`tribegam.cpp:3024-3033`): every unexplored
tile becomes explored and unseen (`visible.cpp:331-353`), no viewer added;
the fog of war stays on (`set_map_fog(fogOfWar())`, `:3034`). The score
table's "highest percent explored" entry (id 8) is only added without
Reveal Map (`tworld.cpp:885-887`).

The summary lines for these (`updateSummary`, `scr_mps.cpp:1864-2071`, and
the scenario's description, `tworld.cpp:496-546`): "Scenario: %s" with
Random Map or Death Match (`:1864-1877`), then after the victory line
"Age: %s" (Default, Nomad, else string 4199 + age, `:1985-1996`), "Resources:
%s" (Default, else 9701 + level, `:1998-2007`), Difficulty and Fixed
Positions, "Reveal Map: %s" and "Full Tech Tree: %s" with Yes or No
(`:2027-2045`), Cheating, Path Finding, Population Limit.

## 3. Players and civilizations

Each of the 8 rows has a name drop-down (Computer / Closed / Open; the host
kicks or opens slots), a **Civ** drop-down (`STRING_ID_MP_CIV_LABEL` 9681),
colour, team, and for scenarios a scenario-player drop-down
(`scr_mps.cpp:104-197`). The civ drop-down lists the 16 civilizations,
Egyptian 1 .. Macedonian 16, then id 17 with string 0x280A, which reads
"Random" in the retail `language.dll` (`scr_mps.cpp:133-150`).

Default civ: `init_vars` seeds `srand(timeGetTime())` and gives every slot
`rand() % 16 + 1` (`scr_mps.cpp:454-466`), a random actual civ, not Random.
While a slot is open the host re-rolls it on every player update
(`scr_mps.cpp:1318-1323`), so a guest who joins starts with the last roll.

## 4. Who may change what

- A player's own civ, colour and team are live only while it is not ready
  (`fillPlayers`, `scr_mps.cpp:1575`, `:1600`, `:1669-1674`); the other rows
  show text. The host also sets computer players' rows (out of scope here).
- A guest's civ reaches the host with its readiness: "I'm Ready!" sends
  `SetMyReadiness(1, civ, ...)` (`scr_mps.cpp:637-660`) and the host copies
  it into the game options (`scr_mps.cpp:1274-1277`). Until then other
  players see the slot's last value.
- The host's settings: only the host, only while not ready (§2).
- **Start Game**: host only, enabled once the host is ready
  (`scr_mps.cpp:685`), refused unless every player is ready
  (`startGame`, `scr_mps.cpp:856-859`, `STRING_ID_ERROR_PLAYERS_NOT_READY`).
- Nothing un-readies a guest when the host changes a setting: the guest sees
  the new summary (inferred: no `SetMyReadiness(0, ...)` on that path).

## 5. Game start: Random civ

`TRIBE_Game::create_game` (`src/tribegam.cpp:2849-2870`), multiplayer:
`srand(comm->GetRandomSeed())`, then for each of the 9 option slots whose
civ is past Macedonian (or negative) `civ = rand() * 16 / 0x7FFF + 1` (C
integer math), flagged `random_civ`. Slots of absent players hold an actual
civ from §3, so only Random players draw, in slot order. The world's
`new_game` then reseeds with the same game seed (`src/world.cpp:984-993`),
so these draws change nothing else.

Quirk: `rand()` returns 0..0x7FFF inclusive, so a draw of 0x7FFF gives
civ 17, past the dat's 16 civs (behaviour in the exe unverified).

## 6. Port status (`packages/sim/src/game-settings.ts`, the lobby)

Ported: the host's Map Size, Map Type and Victory Condition with the Time
Limit and Score amounts and their default lines; Random Map or Death Match
(`GameSettings.deathMatch`; Resources disabled and Default, the victory back
to Standard on a change), the Starting Age with Nomad, the Resources, Reveal
Map and Full Tech Tree (`GameSettings.startingAge`, `resources`, `revealMap`,
`fullTechTree`; the world options of the same names, `resourceLevel` for
Resources, applied as §2.1 in `World` `startEffects`, `techs.ts`
`startInAge`/`revTech`, `Visibility.exploreAll`, `newVictory`'s Reveal Map
score table, and the generator's `nomad`); the Population Limit
(`GameSettings.populationLimit`, the world's `populationLimit` option, so
attribute 32; the sim's caps are `buildings.ts` `updateQueue` and
`checkObjCost`); each player's civ with
Random; the defaults (Large, Mostly Land, Standard); the who-may-change
rules of §4 (server: `apps/server/src/rooms.ts` refuses with `not-host` or
`locked`); Random resolved as §5 (`resolveCivs`; a 0x7FFF draw is kept at
Macedonian 16 rather than reading past the civ table);
`lobbyWorldOptions(seed, settings, civs)` makes the world both clients
build. The default civ is §3's random actual civ, rolled by the server when
the player creates or joins (`RoomRegistryOptions.generateCiv`; the e2e
server fixes it with env `LOBBY_CIV`).

Differs from the original on purpose: a guest's civ is sent when picked,
not with its readiness (both players see every choice live); the host edits
the settings in the room panel, not in a separate dialog.

Offered values (only what the sim can play):

- Map types: all nine, in the original's order (Small Islands 0 .. Narrows
  8). Small Islands and Large Islands separate the two start positions on
  every sampled 2-player map, Narrows on 16 of 168, Coastal and Mediterranean
  rarely (Tiny): the Dock, its boats and the Transport Boat (naval.md §7)
  carry a player across. A seeded 2-player game on each water type starts
  both players with their Town Center and Villagers in one land zone that
  has a beach (`transport.test.ts`).
- Map sizes: all six. Victory: Standard, Conquest, Time Limit, Score with
  every amount (`victory.md` §15: wonder, relic and ruin wins are not
  ported, so Standard plays as Conquest).
- Civs: all 16 and Random.
- Population Limit: all eight, default 50.
- Random Map and Death Match; Starting Age: all six; Resources: all three;
  Reveal Map and Full Tech Tree on or off. The summary shows their lines in
  the original's order (§2.1), without Difficulty, Fixed Positions, Cheating
  and Path Finding. On the fixed test map (`&map=test`) Nomad changes
  nothing (no generator); the other start settings apply.

Not offered (each needs the noted work first): scenarios (scenario loading),
Path Finding (MP `pathingIterations` wiring), Difficulty (computer players),
Fixed Positions off (randomized positions in the generator), Enable Cheating
(chat and cheat codes), colours, teams and more than 2 players.

## 7. Strings (`language.dll` ids)

| text | id |
| --- | --- |
| "Multiplayer Game", "Name", "Civ", "Settings", "I'm Ready!", "Start Game" | 9678, 9680, 9681, 9682, 9663, 9710 |
| "Map Size", "Map Type", "Victory Condition" | 10656, 9691, 10804 |
| map types 0-8: Small Islands, Large Islands, Coastal, Inland, Highland, Continental, Mediterranean, Hill Country, Narrows | 10602 + type |
| map sizes: Tiny, Small, Medium, Large, Huge, Gigantic | 10611 .. 10616 |
| Standard, Conquest, Time Limit, Score | 4332, 4321, 4329, 4330 |
| time limits "15,000 years (2:00 hr)" .. "3,000 years (25 min)" | 9780 .. 9786 |
| civs 1-12 | 10230 + civ |
| Roman, Carthaginian, Palmyran 15, Macedonian 16 | 10246, 10247, 10249, 10248 |
| "Random" (civ 17) | 10250 |
| "Population Limit" (label), its help text | 9747, 30271 |
| summary: "Map Size: %s", "Map Type: %s", "Victory: %s", "Victory: %s (%d)", "Population Limit: %d" | 9690, 9654, 9660, 9662, 9712 |
| "Select Scenario" (the MP dialog's scenario list title), "Random Map", "Death Match", its description | 9726, 9653, 9751, 9752 |
| "Starting Age", "Resources", "Reveal Map", "Full Tech Tree" (labels) | 9734, 9735, 9724, 9732 |
| "Default"; "Nomad"; "Stone Age" .. "Iron Age" (4199 + age) | 4327; 4206; 4201 .. 4204 |
| Resources lines "Medium", "High" (dialog); in the summary 9701 + level | 9737, 9738; 9703, 9704 |
| summary: "Scenario: %s", "Age: %s", "Resources: %s", "Reveal Map: %s", "Full Tech Tree: %s"; "Yes", "No" | 9709, 9700, 9701, 9656, 9708; 4003, 4004 |
| help: Starting Age, Resources, Reveal Map, Full Tech Tree | 30257, 30258, 30260, 30263 |
