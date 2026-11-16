# Core: update loop, turns, commands, numbers, RNG

Source: aoe1-decomp @ `6d6d8b1` (July 1998 RoR beta; see `README.md` for the
version caveat and reference format). Status letters: M matching,
D accepted_drift, L accepted_logic, N nonmatching.

## 1. Frame and update loop

### 1.1 Call chain

| step | function | ref | status |
| --- | --- | --- | --- |
| Windows message loop | `RGE_Base_Game::run` | `src/basegame.cpp:884` | M |
| idle hook | `TRIBE_Game::handle_idle` | `src/tribegam.cpp:3835` | M |
| calls game screen | (same function) | `src/tribegam.cpp:3896` | |
| rate limit + 1 or 2 world updates | `TRIBE_Screen_Game::handle_game_update` | `src/scr_game.cpp:1086` | M |
| one simulation step | `RGE_Game_World::update` | `src/world.cpp:1206` | M |

`handle_game_update` returns early if less than `update_interval` ms of
wall time passed since the last call (`src/scr_game.cpp:1092-1095`;
`update_interval` comes from program info, `src/scr_game.cpp:87`). In
multiplayer it may run **two** world updates in one frame when the local
average frame time is in a middle band (67–125 ms) and `multi_updates` is on
(`src/scr_game.cpp:1119-1123`); otherwise one. The world call is at
`src/scr_game.cpp:1145`. None of this changes the simulation result, only how
fast steps happen in wall time.

### 1.2 `RGE_Game_World::update` (`src/world.cpp:1206`, M)

In order:

1. **Ask the network layer for a step size**: `cycle = DoCycle(world_time)`
   (`src/world.cpp:1222`). Meaning of the result:
   - `0`: no step this frame. `world_time_delta = 0`, return at once
     (`src/world.cpp:1225-1228`). The RNG is not touched.
   - `-1`: free-running (single player, not paused): use wall clock.
   - `N > 0`: step exactly `N` ms of base time (multiplayer).
2. Debug override: if `do_fixed_update` is set, `cycle = fixed_update_time`
   (`src/world.cpp:1233-1234`; defaults 0 / 100 ms at
   `src/game_globals.cpp:641-643`, set only by debug/command-line options in
   `src/basegame.cpp:1001-1002`, `1276-1339`).
3. **Seed the RNG** from the world's stored seed:
   `srand(random_seed)` (`src/world.cpp:1236`). See §4.
4. Update sounds and sprite animation with the *wall clock* time
   (`src/world.cpp:1237-1239`) — presentation only.
5. **Elapsed base time** (`src/world.cpp:1241-1252`):
   - `cycle == -1`: `elapsed = now - old_time` (wall ms), clamped to at most
     100 ms; on the very first update `elapsed = 0` and `first_update` is set.
   - otherwise `elapsed = cycle`.
6. **Advance the clock** (`src/world.cpp:1255-1267`):
   `world_time = old_world_time + trunc_to_uint(elapsed * game_speed)`.
   The product is float; the cast truncates and the fraction is lost (the
   decomp notes this as a bug at `src/world.cpp:1262-1264`). A `temp_pause`
   frame advances only when `cycle != -1`.
   `world_time_delta = world_time - old_world_time` (`src/world.cpp:1267`).
7. **Only if `world_time_delta != 0` or first update**
   (`src/world.cpp:1269-1298`):
   1. Execute every command scheduled for the current turn:
      `commands->do_commands()` (`src/world.cpp:1270`; §2.4).
   2. `scenario->update()` (`src/world.cpp:1271`; `src/scenario.cpp:701`).
   3. `world_time_delta_seconds = world_time_delta * 0.001f`
      (`src/world.cpp:1272`; constant at `src/game_globals.cpp:408`).
   4. For player index 0 (Gaia) up to `player_num - 1`, in index order:
      add the delta to `player_time_delta[i]`, call `players[i]->update()`,
      clear its tile list (`src/world.cpp:1274-1280`). `RGE_Player::update`
      (`src/player.cpp:870`, M) updates the player's object list
      (`RGE_Object_List::update`, `src/obj_list.cpp:226`), selection, victory
      conditions and visibility tiles. AI and unit behaviour run inside this.
      `TRIBE_Player::update` (players ≥ 1, not Gaia's `TRIBE_Gaia::update`)
      ends with a fence around the computer-player AI: `r = rand()`, AI
      update, `srand(r)` (`src/tplayer.cpp:607-631`; visibility.md §6).
   5. **RNG fence around fog "ghost" objects**: draw `r = rand()`
      (`src/world.cpp:1283`), update every player's doppelganger objects and
      creator checks (`src/world.cpp:1284-1293`), then `srand(r)`
      (`src/world.cpp:1294`). Whatever random numbers those local-view
      updates consume, the stream afterwards depends only on `r`.
   6. Rotate `player_turn` (`src/world.cpp:1295-1298`) and call
      `check_game_state()` (`src/world.cpp:1299`; `src/world.cpp:1377`, M;
      overridden by `TRIBE_World::check_game_state`, `src/tworld.cpp:923`).
8. **Store the next seed**: `random_seed = rand()` (`src/world.cpp:1302-1303`)
   — runs whenever step 1 returned non-zero, even if the delta was 0.
   It is handed to the sync checker: `com_hand->LastWorldRandom(random_seed)`
   (`src/world.cpp:1306`, `src/com_hand.cpp:434`).

### 1.3 Time units and game speed

- Base unit: integer milliseconds of game time (`world_time`, unsigned 32-bit,
  `include/world.h:134`).
- `game_speed` is a float multiplier (`include/world.h:139`). The in-game
  speed buttons step through 1.0 → 1.5 → 2.0; 4, 8 and 16 exist only in
  single player with developer mode (`src/scr_game.cpp:3905-3935`). Initial
  value from the registry as `value * 0.1f` (`src/basegame.cpp:279-281`).
- A speed change is issued as a game command
  (`src/scr_game.cpp:3946`), executed in turn order by
  `TRIBE_Command::do_command` → `world->set_game_speed`
  (`src/tcommand.cpp:376-377`), so all peers switch on the same turn. Single
  player also sets it directly (`src/scr_game.cpp:3947-3948`). A
  multiplayer game starts at 1.0 (`src/world.cpp:1056-1061`); who changes
  it and how: lobby.md §8 (ported).
- Per-object code uses `world_time_delta` (ms) or
  `world_time_delta_seconds` (float s). Example: `TRIBE_Player::update`
  accumulates the float seconds and logs population history every 15 s
  (`src/tplayer.cpp:352-363`, M).

## 2. Turns and command scheduling (multiplayer lockstep)

The engine is peer-to-peer lockstep over DirectPlay: every peer runs the full
simulation; only commands and control messages travel.

### 2.1 What `DoCycle` decides (`src/com_hand.cpp:453`, D)

- Not multiplayer: return 0 if paused, else -1 (`src/com_hand.cpp:454-456`).
- Multiplayer, each call: receive messages (`src/com_hand.cpp:472`); if this
  turn has not been acknowledged yet, send a `'D'` ("done") message for turn
  `current_turn + CommandTurnIncrement` (`src/com_hand.cpp:475-490`).
- Run the sync checksum for the turn (`src/com_hand.cpp:501`; §2.5).
- **Inside a turn**: while buffer frames remain and `current_turn > 6`,
  return `Speed->BufferTimeToUse(current_turn)` (`src/com_hand.cpp:508-510`).
- **At a turn boundary**: if not every player has acknowledged, return 0 and
  handle timeouts (`src/com_hand.cpp:514-625`). Otherwise (state must be
  RUNNING): reload buffer frames, the host may re-analyse game speed,
  `current_turn += 1`, and return the frame granularity
  (`src/com_hand.cpp:627-639`).

### 2.2 Turn length (`src/com_spd.cpp`)

Full account, with the speed analysis and worked examples:
[turn-timing.md](turn-timing.md).

Defaults set in the constructor `RGE_Communications_Speed`
(`src/com_spd.cpp:11-45`, M): frame granularity `G` 90 ms, 10 buffer frames
`F` per turn. Its `TargetTurnLengthMsec` (500) is never read.

- `ReloadBufferFrames` (`src/com_spd.cpp:140`, M): restart the turn's wall
  timer, apply any scheduled speed change, set frames remaining to
  `CurrentBufferFrames`.
- `BufferTimeToUse` (`src/com_spd.cpp:147`, M): returns the granularity and
  decrements frames remaining only when wall time since the turn started has
  caught up with `(frames used) * granularity` (`OverheadFactor` is always
  0); otherwise returns 0 and counts a dropped frame.
- Reading of the code (unverified by running): one turn = the boundary
  frame plus `CurrentBufferFrames` buffer frames, each stepping
  `granularity` ms of base time, so `(F + 1) · G` = 11 × 90 = 990 ms of base
  time per turn at defaults, and about `(F − 1) · G` + one loop pass of wall
  time. For the first 6 turns the buffer path is skipped
  (`src/com_hand.cpp:509`), so each early turn is a single step.
- The host retunes `G` and `F` during the game: `AnalyzeGameSpeed`
  (`src/com_spd.cpp:326`, **L**) picks them from the players' frame times and
  round trips; peers receive an `'S'` message stamped for turn `E` and
  schedule it with `SetFutureSpeedChange` (`src/com_hand.cpp:1352-1355`,
  `src/com_spd.cpp:81`); `AdjustLocalSpeed` (`src/com_spd.cpp:114`, M)
  applies it at the boundary `E → E + 1`, so turn `E + 1` is the first to run
  at the new values. With 30 ms frames on a LAN this settles at `G` = 30,
  `F` = 9 from turn 25.

**Implication for the port:** the step size is the agreed granularity (never
wall time), so `world_time` advances identically on every peer, but it is not
a constant: `G` and `F` must travel in the turn stream and every peer must
switch on the same turn (turn-timing.md §8). The command delay stays 2 turns.

### 2.3 Issuing a command

- UI/AI builds a command struct and calls `new_command`
  (`src/com_hand.cpp:395`) → `NewCommand` (`src/com_hand.cpp:399`, M).
- Multiplayer: sent with message type `'>'` (0x3E) via `CommOut`
  (`src/com_hand.cpp:404`). `CommOut` stamps
  `ExecuteOnTurn = current_turn + CommandTurnIncrement`
  (`src/com_hand.cpp:2810-2811`) and a per-turn sequence number from
  `GetNextSequence` (`src/com_hand.cpp:2827`); if the sequence wrapped to 0
  outside state 5, the command is refused (`src/com_hand.cpp:2828-2830`).
  After a successful send the sender queues its own copy for that turn
  (`src/com_hand.cpp:2956-2957`). Receivers queue it on arrival
  (`src/com_hand.cpp:1348-1349`).
- Single player: queued directly for `current_turn + CommandTurnIncrement`
  (`src/com_hand.cpp:406-408`).
- `CommandTurnIncrement` is 2 everywhere it is set
  (`src/com_hand.cpp:265`, `3007`, `3968`, …; field at
  `include/com_hand.h:164`). So a command runs **two turns after** the turn
  in which it was issued.
- `GetNextSequence` (`src/com_q.cpp:335`, M): restarts at 1 on a new turn,
  then counts up; reaching 255 yields 0 (refused).

### 2.4 Executing commands

- `RGE_Command::do_commands` (`src/Command.cpp:67`, M) pops commands until
  the queue has none for now and dispatches each through `do_command`
  (`src/Command.cpp:80`, M; tribe-specific ones in
  `TRIBE_Command::do_command`, `src/tcommand.cpp:36`, M).
- **Each executed command draws one `rand()` first**, before its type switch,
  and discards it (`src/tcommand.cpp:37`). So every command consumes one
  draw of the step's stream, whatever it does afterwards (see `economy.md`).
- `get_command` (`src/com_hand.cpp:385`, M): single player takes any queued
  item (`GetNextItemSingle`); multiplayer takes
  `GetNextItemOrdered(current_turn)`.
- `GetNextItemOrdered` (`src/com_q.cpp:296`, M) returns, among queued items
  whose execute-turn equals the current turn, the one with the smallest
  `Code`, where `Code = sequence + sender_player * 1000`
  (`src/com_q.cpp:228`). **Deterministic order: by sender player number,
  then by that sender's sequence.** Items for an already-passed turn are
  never executed, only logged (`src/com_q.cpp:304-306`).
- Commands run at the start of the first world step with a non-zero delta
  in that turn (`src/world.cpp:1270`), before any player updates.

### 2.5 Sync check

`RGE_Communications_Synchronize::DoChecksum` (`src/com_sync.cpp:132`, M)
runs every 4 turns (`src/com_sync.cpp:148`) and exchanges: world time, the
last `random_seed` (§1.2 step 8), unified visible-map checksum, three world
checksums from `RGE_Base_Game::GetWorldChecksums`
(`src/basegame.cpp:3699`) and the pathing checksum
(`PathingSystem::checksum`, `src/pathsys.cpp:1172`)
(`src/com_sync.cpp:150-178`). A mismatch flags out-of-sync and stops the game
(`src/com_hand.cpp:503-505`).

**Implication for the port:** a cheap desync detector is to compare
`(world_time, random_seed)` every 4 turns, as the original does.

## 3. Numeric types

| quantity | type | ref |
| --- | --- | --- |
| game clock, delta | unsigned 32-bit ms | `include/world.h:134-136` |
| delta in seconds | float (`delta * 0.001f`) | `include/world.h:169`, `src/world.cpp:1272` |
| game speed | float | `include/world.h:139` |
| object position x/y/z | float | `include/stat_obj.h:457-459` |
| object hit points | float (instance) | `include/stat_obj.h:452` |
| master (type) hit points | short | `include/m_s_obj.h:490` |
| resource carried | float | `include/stat_obj.h:460` |
| player attributes (resources, pop, …) | float array | `include/player.h:457` |
| unit-AI time | unsigned ms | `src/aiuaimod.cpp:409` |
| RNG output | int, 0..32767 | §4 |
| screen/draw coords | short | `include/stat_obj.h:120-134` |

- **No fixed-point** type is used in simulation code (a search of `include/`
  for fixed-point names or `>> 16` scaling found none outside UI/file info).
- A few tuning constants are `double` globals
  (`include/game_globals.h:146-179`); arithmetic mixes them with float
  fields.
- Float → integer conversions are C casts: truncation toward zero (example
  `src/world.cpp:1265`).
- Compiled by VC5 with `/O2 /Oy` (`config/flags/default.rsp:1`) to x87 code.
  The x87 precision-control mode at run time is **unverified** (Windows
  default is 53-bit; DirectX can change it).

**Implication for the port** (unverified until golden tests): emulate float
fields with `Math.fround` at every store to a float field, keep integer
fields as 32-bit integers, and never use wall time or `Math.random` in the
simulation (project rule).

## 4. RNG

### 4.1 Algorithm

- Every simulation random number goes through `debug_rand`
  (`src/basegame.cpp:3989`, M), which calls the C runtime `rand()` and only
  adds optional debug logging. Seeding goes through `debug_srand`
  (`src/basegame.cpp:4015`, M) → `srand`. A search of `src/` finds no other
  direct `rand()` call (`src/basegame.cpp:3990` is the only one).
- `rand`/`srand` are not in the decomp: they come from the statically linked
  Visual C++ 5.0 runtime. No `/MD` or `/MT` appears in
  `config/flags/default.rsp`, so VC5's default single-threaded LIBC with one
  global state word is assumed. Its algorithm is Microsoft's documented LCG:
  - `srand(s)`: `state = s` (32-bit unsigned).
  - `rand()`: `state = state * 214013 + 2531011 (mod 2^32)`; return
    `(state >> 16) & 0x7FFF`.
  Status: **unverified against the exe bytes** (to confirm in R0 against the
  retail `Empiresx.exe`).

### 4.2 Seeding and call order

- World constructor default: `random_seed = 14` (`src/world.cpp:95`).
- New random-map game, `RGE_Game_World::new_game` (N):
  initial seed = shared multiplayer seed from `GetRandomSeed`
  (`src/world.cpp:984-985`) or `random_game_seed` in single player, itself
  drawn at random if it is -1 (`src/world.cpp:987-990`). Then
  `srand(initial_seed)` (`src/world.cpp:993`), and `random_seed` is redrawn
  with `rand()` at fixed milestones: after seeding, after the map, after Gaia,
  after players, end of setup (`src/world.cpp:995`, `1000`, `1006`, `1009`,
  `1083`).
- Scenario start, `RGE_Game_World::new_scenario` (L): same pattern
  (`src/world.cpp:1104-1108`, `1153-1183`).
- Multiplayer seed: the host sets `PlayerOptions.RandomSeed` in
  `SetRandomSeed` (`src/com_hand.cpp:3558`, M), drawing one from a
  time-seeded `rand` when given -1, and shares it with all peers;
  `GetRandomSeed` (`src/com_hand.cpp:3574`, M) returns it (single player:
  a fresh time-seeded draw).
- Every world step: §1.2 steps 3, 7.5 and 8. The RNG is reset from
  `random_seed` at the start of each step and `random_seed` is the last
  `rand()` of the step, so **the RNG state carried between steps is a single
  15-bit value** (0..32767).
- Local-only consumers are fenced so they do not disturb the stream: unit
  creation/recycle and death sounds save a draw, play the sound, and reseed
  (`src/stat_obj.cpp:170-179`, `src/stat_obj.cpp:280-286`,
  `src/stat_obj.cpp:1193-1199`); doppelgangers are fenced in the world step.
- Within a step, draws happen in the order of §1.2 step 7 (commands, then
  scenario, then players 0..n-1 each updating their objects in list order).
  The exact draw sites per subsystem are for the R2/R3 specs; 267 lines in
  `src/*.cpp` contain `debug_rand(` (summed `grep -c`, including the
  definition and declarations).

### 4.3 Worked example

Start of a step with `random_seed = 14`, a world of Gaia alone (no player
fence, §1.2 step 7.4) and, for illustration, no random draws by commands,
scenario or objects:

| action | state after (32-bit) | returned |
| --- | --- | --- |
| `srand(14)` (§1.2 step 3) | 14 | |
| `rand()` (step 7.5) | 14 × 214013 + 2531011 = 5 527 193 | 5 527 193 >> 16 = **84** |
| `srand(84)` (step 7.5) | 84 | |
| `rand()` (step 8) | 84 × 214013 + 2531011 = 20 508 103 | 20 508 103 >> 16 = **312** |

So the next step starts with `random_seed = 312`; continuing the same way
gives 312 → (1057) → 3490, then 3490 → (11435) → 4612. For reference, the
raw stream after `srand(14)` is 84, 27125, 9192, 11643, 22187 (state wraps
mod 2^32 from the second draw: 5 527 193 × 214013 + 2531011 mod 2^32 =
1 777 680 120 → 27125).

With Gaia and two players, each player's fence adds `srand(rand())` before
step 7.5: from 14 the stored seeds are 3490, 16577, 14304.

**Implication for the port:** a golden test can check this table directly.
