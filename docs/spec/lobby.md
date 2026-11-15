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
| `TRIBE_Game::create_game` | `src/tribegam.cpp:2739` | L | resolves a Random civ from the game seed (§5) |

## 2. The host's settings (Game Settings dialog, `src/scr_set.cpp`)

Only the host has the **Settings** button (`STRING_ID_MP_SETTINGS_LABEL` 9682,
`scr_mps.cpp:204-210`); a guest gets the same label as a title over the
summary (§7). The button is disabled while the host is ready
(`scr_mps.cpp:684`). The dialog's controls, in the order the constructor
makes them, with the multiplayer defaults `init_vars` sets
(`scr_mps.cpp:431-452`):

| control | values (drop-down order) | MP default |
| --- | --- | --- |
| scenario list | "Random Map" (id −2), "Death Match" (−1), then each scenario file (`fillScenarios`, `scr_set.cpp:617-622`) | Random Map |
| Map Size | Tiny 72, Small 96, Medium 120, Large 144, Huge 200, Humongous 250 (shown "Gigantic") | Large |
| Map Type | AllWater .. Isthmas, `TRIBE_Game::MapType` 0-8 (§7 names) | MostlyLand 3 |
| Victory Condition | random map: Standard (stored as `VictoryDefault` 0), Conquest 1, Time Limit 7, Score 8; a scenario adds Default 0 and Standard 9 | Default (Standard) |
| Time Limit (only for Time Limit) | 15000, 13000, 11000, 9000, 7000, 5000, 3000 years | line 3, 9000, when Time Limit is picked |
| Score (only for Score) | 3000, 2700, 2400, 2100, 1800, 1500, 1200, 900, 800, 700, 600, 500, 400, 300 | line 7, 900, when Score is picked |
| Starting Age | Default, Nomad, Stone, Tool, Bronze, Iron | Default |
| Resources | Default, Medium, High; inactive and forced Default for Death Match (`scr_set.cpp:737-741`, `:785-791`) | Default |
| Path Finding | Default, Medium, High (MP: `mpPathFinding`) | Default (`basegame.cpp:101`) |
| Population Limit (MP only) | 25, 50, 75, 100, 125, 150, 175, 200 (`scr_set.cpp:181-194`, made only when `multiplayerGame()`) | 50 (`tribegam.cpp:198`, `:2230`) |
| Difficulty Level | Easiest .. Hardest (computer players) | single player's |
| Fixed Positions (check) | on = `randomizePositions` 0 | on |
| Full Tech Tree (check) | | off |
| Reveal Map (check) | `fullVisibility` | off |
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
Limit and Score amounts and their default lines; the Population Limit
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

- Map types: Inland 3, Highland 4, Continental 5, Hill Country 7: the
  Villager's terrain table joins the two Town Centers (4-neighbour flood
  fill over the generated terrain) on every sampled 2-player map, 128 to 208
  per type (20 seeds at each of the six sizes, more on Tiny, Medium, Large).
  Not offered: Small Islands 0 and Large Islands 1 (separate in every
  sample), Narrows 8 (separate in 16 of 168), Coastal 2 (1 of 168) and
  Mediterranean 6 (1 of 208; both on Tiny). Those need the Dock and boats
  (Fishing Boat, transport), which the sim does not have.
- Map sizes: all six. Victory: Standard, Conquest, Time Limit, Score with
  every amount (`victory.md` §15: wonder, relic and ruin wins are not
  ported, so Standard plays as Conquest).
- Civs: all 16 and Random.
- Population Limit: all eight, default 50.

Not offered (each needs the noted work first): Death Match (its start
resources), scenarios (scenario loading), Starting Age (Nomad: the
generator's nomad rows and `random_start`'s fallback; ages: the age techs at
start), Resources Medium/High (`resourceLevel` start amounts), Path Finding
(MP `pathingIterations` wiring), Difficulty (computer players), Fixed Positions off
(randomized positions in the generator), Full Tech Tree, Reveal Map (full
visibility), Enable Cheating (chat and cheat codes), colours, teams and more
than 2 players.

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
