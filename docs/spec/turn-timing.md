# Turn timing: latency, step size, buffer frames, command delay

Source: aoe1-decomp @ `6d6d8b1` (see `README.md`). Status letters: M
matching, D accepted_drift, L accepted_logic, N nonmatching. Builds on
[core.md](core.md) §2.1–2.3, which covers `DoCycle` and command stamping.

Symbols used below:

- `G` = `CurrentBufferGranularity`: base-time milliseconds per simulation
  step (`include/com_spd.h:23`).
- `F` = `CurrentBufferFrames`: buffer steps per turn after the boundary step
  (`include/com_spd.h:19`).
- `CTI` = `PlayerOptions.CommandTurnIncrement` (`include/com_hand.h:164`).
- `T` = `current_turn` at a turn boundary, *before* it is incremented.

## 1. Defaults

Set in the `RGE_Communications_Speed` constructor (`src/com_spd.cpp:11-45`,
M):

| field | value |
| --- | --- |
| `G` (current and "optimal") | 90 ms |
| `F` (current and "optimal") | 10 |
| `ActualLatency[1..9]` (round trip per player) | 30 ms |
| `HighestLatencyMsec` | 500 |
| `SpeedControlEnabled` | 1 |
| `OverheadFactor` | 0 (never assigned elsewhere: no reference outside `src/com_spd.cpp`) |
| `TargetTurnLengthMsec` | 500, **never read** (only the constructor touches it) |

`CTI` is 2 everywhere it is assigned (`src/com_hand.cpp:265`, `3007`, `3098`,
`3180`, `3275`, `3303`, `3968`) and nothing changes it during a game. Only
`G` and `F` adapt; the command delay in turns is fixed.

## 2. What one turn is

From `DoCycle` (`src/com_hand.cpp:453`, D) and `BufferTimeToUse`
(`src/com_spd.cpp:147`, M):

- **Boundary step.** When the turn's buffer steps are used up and every
  human player has acknowledged the current turn
  (`AllPlayersAcknowledged`, `src/com_hand.cpp:2050-2072`, M: each
  `LastTurnAck[i] >= current_turn`), `DoCycle` calls `ReloadBufferFrames`
  (`src/com_hand.cpp:630`), lets the host analyse speed
  (`src/com_hand.cpp:633-635`), increments `current_turn`
  (`src/com_hand.cpp:636`) and returns `G` (`src/com_hand.cpp:639`). That is
  one step of `G` ms.
- `ReloadBufferFrames` (`src/com_spd.cpp:140-145`, M) restarts the turn's
  wall clock (`TurnTSLC`), applies a pending speed change (§5), then loads
  `F` buffer steps.
- **Buffer steps.** While steps remain and `current_turn > 6`, each
  `DoCycle` returns `BufferTimeToUse` (`src/com_hand.cpp:508-510`). Buffer
  step number `k` (0-based) is released only once wall time since the
  boundary is at least `k · G` (`src/com_spd.cpp:160-177`;
  `OverheadFactor` = 0); otherwise the call returns 0 (no step this frame)
  and counts a dropped frame.
- Turns 0–6 skip the buffer path, so each of them is a single boundary step
  (`src/com_hand.cpp:509`).

So, for turns after 6:

- base (game) time per turn = `(F + 1) · G` ms;
- wall time per turn, when nobody is waiting for acks, ≈ `(F − 1) · G` + one
  pass of the game loop (step `k = 0` runs at once, the last buffer step at
  `(F − 1) · G`, the next boundary on the following loop pass). Reading of the
  code, unverified by running. Base time therefore runs slightly ahead of the
  wall clock (at defaults 990 ms of game per ≈ 810 ms + one frame of wall).
- The game loop itself is not throttled: `update_interval` is 1 ms
  (`src/main.cpp:44`, checked at `src/scr_game.cpp:1092-1095`).

The speed analysis (§4) measures a turn as `F · G` (it ignores the boundary
step); this spec quotes both where it matters.

## 3. What is measured

### 3.1 Round-trip time per peer (pings)

- `CheckPingTime` (`src/com_hand.cpp:835-854`, M) runs at the end of every
  `ReceiveGameMessages` (`src/com_hand.cpp:721`), i.e. once per `DoCycle`.
  For every other human player it sends a ping when more than 8000 ms passed
  since the last one to that player, or when forced (a stalled turn after
  25 s, `src/com_hand.cpp:617-620`; on becoming host,
  `src/com_hand.cpp:1781`).
- `TXPing` (`src/com_hand.cpp:856-884`, M) sends message `'1'` holding the
  sender's `timeGetTime` and current turn by `FastSend`, outside the
  guaranteed command stream (`CommOut` logs ping types as bad,
  `src/com_hand.cpp:2789-2791`).
- The receiver answers in `PreprocessMessages` (`src/com_hand.cpp:950`, L)
  with `'2'` echoing the original timestamp (`src/com_hand.cpp:1099-1128`).
- On `'2'` the pinger computes `now − timestamp` and stores it with
  `SetActualLatency` (`src/com_hand.cpp:1183-1207`), which clamps it to
  `[30, 6000]` ms (`src/com_spd.cpp:71-79`, M). This is a **round trip**,
  and it includes up to one game-loop pass on the far side, because messages
  are only read inside `DoCycle`. A player's own slot stays at 30.

### 3.2 Frame time per machine

- `FrameTSLC` is a 100-slot ring of wall-clock intervals
  (`src/rge_tslc.cpp:51-71`, M). `BufferTimeToUse` calls `Set` when the
  previous `DoCycle` produced a step and `Skip` otherwise
  (`src/com_spd.cpp:148-152`); the boundary step marks itself with
  `GetBufferGranularityAdjusted` (`src/com_spd.cpp:101-104`). Each sample is
  therefore the wall time from one stepping `DoCycle` to the next call: the
  cost of one loop pass that simulated and drew a step.
- `GetAvgFrameRate` = integer mean of the last 50 samples
  (`src/com_spd.cpp:306-308`, `src/rge_tslc.cpp:25-45`, M). Despite the
  name it is milliseconds per frame.

### 3.3 Reporting: the `'D'` (turn done) message

On the first `DoCycle` of each turn, each player sends `'D'` for
`current_turn + CTI` (`src/com_hand.cpp:475-491`; same code in the ping
handlers, `src/com_hand.cpp:1105-1116`, `1190-1204`). When
`current_turn > 6` it carries two bytes:

- `HighLatencyCenti`: the largest `ActualLatency` among human players, in
  centiseconds, `(ms + 5) / 10` clamped to `[1, 255]`
  (`GetHighLatencyCenti`, `src/com_spd.cpp:185-212`, M);
- `FrameRateMsec`: `GetAvgFrameRate`, truncated to a byte in the ping-path
  copies (`src/com_hand.cpp:1111`, `1196`).

The sender records its own values with `SetPlayerTurnSpeed`
(`src/com_hand.cpp:484`); every receiver records the sender's
(`src/com_hand.cpp:1318-1320`). `SetPlayerTurnSpeed`
(`src/com_spd.cpp:61-69`, M) stores `PlayerAvgFramesMsec[p]` and
`PlayerHighLatencyMsec[p] = centi · 10`. The same `'D'` also acknowledges
turn `ExecuteOnTurn − CTI` for that player (`src/com_hand.cpp:1328-1331`).

## 4. Choosing step size and buffer frames (host only)

`AnalyzeGameSpeed` (`src/com_spd.cpp:326-406`, **L** — not byte-proven) runs
at every turn boundary on the host (`src/com_hand.cpp:633-635`, guarded by
`MeHost`; the function also returns at once unless `IsHost`). In order:

1. Return if a change is already pending (`NextLatencyChangeTurn != 0`).
2. `SyncTurn = T + CTI`; return if `SyncTurn < 20`.
3. `LastAdjusted += 1`; return unless it reached 5. (`AdjustLocalSpeed`
   resets it to 0 on every boundary while a change is pending, including the
   one that applies it, `src/com_spd.cpp:119-127`.)
4. `A = max(10, PlayerAvgFramesMsec over human players)`;
   `H = max(30, PlayerHighLatencyMsec over human players)` (the host's own
   values included).
5. Granularity: `g = round_to_10(A) = ((A + 5) / 10) · 10`, capped at 150.
   If `|g − G| < 10`, keep `g = G`.
6. Frames: `f = H / g + 2` (integer division), clamped to `[4, 20]`; then if
   `g · f < 250`, `f = 250 / g + 1`. So `F · G` never drops below 250 ms.
7. Compare `new = g · f` with `cur = F · G`. If `|new − cur| <= 10`, no
   change.
8. Step-down damping: if `new < cur`, the drop exceeds 100 ms, and `F > 4`,
   then `f = F − 1` (granularity still jumps to `g`; frames come down one per
   adjustment).
9. If `ChangeAlso` (always 1 here) and `SpeedControlEnabled`: schedule the
   change locally for `SyncTurn` and send it (§5).

`GetRecommendedBufferFrames` / `GetRecommendedBufferGranularity`
(`src/com_spd.cpp:280-324`, M) use a different rule (`latency / G + 1`,
`G` from the local frame average) but are only called by the debug string
`GetSelfPlayerOptimalSpeedStr` (`src/com_spd.cpp:234-245`); they do not
drive the game.

## 5. Agreeing and applying the change deterministically

- **Host, at boundary `T`:** `SetFutureSpeedChange(f, g, T + CTI)`
  (`src/com_spd.cpp:81-87`, M; ignored while another change is pending) and
  `SendSpeedChange` (`src/com_hand.cpp:1993-2001`, M), which sends `'S'`
  (frames and granularity as 16-bit values) through `CommOut`. `CommOut`
  stamps it `ExecuteOnTurn = current_turn + CTI`
  (`src/com_hand.cpp:2810-2811`, D). The host has not incremented yet, so
  the stamp equals the host's `SyncTurn`: `E = T + 2`.
- **Every peer:** on `'S'`, `SetFutureSpeedChange(frames, size,
  ExecuteOnTurn)` (`src/com_hand.cpp:1352-1355`).
- **Apply:** `AdjustLocalSpeed` (`src/com_spd.cpp:114-138`, M), called from
  `ReloadBufferFrames` at each boundary, copies the future values into
  `G`/`F` once `current_turn >= E` (pre-increment), and counts
  `AdjustmentCount`. That is boundary `E → E+1`, so **turn `E + 1 = T + 3`
  is the first turn with the new `G` and `F`**, for its boundary step
  (returned after the reload, `src/com_hand.cpp:639`) and its buffer steps.
- **Why every peer has it in time** (reading, unverified by running): the
  host sends `'S'` at boundary `T`, before its `'D'` for turn `T + 1` (sent
  on its next `DoCycle`). No peer can leave turn `T + 1` without that `'D'`
  (§2). With per-sender in-order delivery of the guaranteed stream, every
  peer holds the change one full turn before boundary `E`.
- Because every peer switches at the same turn and steps the same `G`, the
  simulation stays in lockstep; `G` is the `world_time` delta of each step
  (core.md §1.2 step 5), so **the simulation step size itself changes during
  a game**.
- **Cadence:** first analysis at the fifth boundary with `T + 2 >= 20`, i.e.
  `T = 22`, applied from turn 25. After a change applied at boundary `E`,
  the next analysis is at boundary `E + 4`, so changes are at most one per
  6 turns. With no change needed, the host re-analyses every boundary.

## 6. Click-to-action latency

A command issued during turn `t` is stamped `t + 2` (core.md §2.3) and runs
on the first step of turn `t + 2`. Wall delay = rest of turn `t` + all of
turn `t + 1`: between one and two wall turns, about 1.5 on average.

## 7. Worked examples

Assumptions (unverified; the decomp does not fix them): both machines report
`A = 30` ms per stepping frame (≈ 33 fps), a loop pass is ≈ 30 ms, and the
measured round trip equals the network round trip (the far side's loop
delay ignored).

### 7.1 LAN, 10 ms RTT

- Turns 7–24 run at defaults: `G = 90`, `F = 10`; base 990 ms per turn,
  wall ≈ 810 + 30 ≈ 840 ms. Click-to-action ≈ 0.84–1.7 s. Turn 25 is
  reached ≈ 15 s of wall time after turn 7.
- Measured RTT 10 → clamped to 30 → `HighLatencyCenti = 3` → `H = 30`.
- First analysis (boundary 22): `g = 30` (differs from 90 by 60).
  `f = 30/30 + 2 = 3` → 4; `30 · 4 = 120 < 250` → `f = 250/30 + 1 = 9`.
  `new = 270`, `cur = 900`; drop 630 > 100 and `F = 10 > 4` → `f = 9`.
  Change `G = 30`, `F = 9` scheduled for turn 24, live from turn 25.
- Next analysis (boundary 28): `g = 30`, `f = 9`, `new = cur = 270` → no
  change. Steady state `G = 30`, `F = 9`.
- Steady state: base 300 ms per turn, wall ≈ 240 + 30 ≈ 270 ms.
  **Click-to-action ≈ 270–540 ms, ≈ 400 ms on average.**

### 7.2 Internet, 120 ms RTT

- Measured 120 → `HighLatencyCenti = 12` → `H = 120`.
- First analysis: `g = 30`; `f = 120/30 + 2 = 6`; `30 · 6 = 180 < 250` →
  `f = 9`. Same result as the LAN: `G = 30`, `F = 9`.
- No stall: a peer needs the other's `'D'` for turn `t` (sent at the start
  of its turn `t`, one-way ≈ 60 ms) before leaving turn `t` (≈ 270 ms
  later), and commands for `t + 2` arrive ≈ 60 ms after they are sent.
- **Click-to-action ≈ 270–540 ms**, as on the LAN. With `A = 30`, latency
  only lengthens turns once `H / 30 + 2 > 9`, i.e. RTT ≥ 240 ms.

### 7.3 Slow machine, 400 ms RTT (shows the step-down damping)

`A = 70`, `H = 400`. Wanted: `g = 70`, `f = 400/70 + 2 = 7`, `new = 490`.

| analysis | cur `F · G` | computed `f` | damping | result `G`, `F` | `F · G` |
| --- | --- | --- | --- | --- | --- |
| 1 | 10 · 90 = 900 | 7 | drop 410 > 100 → `F − 1` | 70, 9 | 630 |
| 2 | 630 | 7 | drop 140 > 100 → `F − 1` | 70, 8 | 560 |
| 3 | 560 | 7 | drop 70 ≤ 100 → none | 70, 7 | 490 |

Each row is 6 turns after the previous. Steady wall turn ≈ 6 · 70 + 70 ≈
490 ms; click-to-action ≈ 0.5–1.0 s.

### 7.4 Frame time of 17 ms (a 60 Hz browser), 10 ms RTT

`g = 20`, `f = 30/20 + 2 = 3` → 4 → `250/20 + 1 = 13` (`new = 260`). From
900 the damping gives `G = 20`, `F = 9` (`F · G = 180`, below the 250 floor
for one period); the next analysis sees `new = 260 > 180` (no damping on
the way up) and sets `F = 13`. Steady: base 280 ms, wall ≈ 240 + 17 ≈ 257 ms
per turn.

## 8. Implications for the port

These are what the relay server and client lockstep must do over WebSockets
to reproduce §§2–6; they are not decomp behaviour.

1. **Per-turn `G` and `F` in the turn stream.** The sim must step `G` ms
   (not a constant 90) and a turn must be 1 + `F` steps, with turns 0–6 one
   step each. (Before the port implemented this it fixed 11 × 90 ms, which
   equals the original only before the first adjustment, turns 7–24.)
2. **The server plays the host.** Only one party may decide. The server runs
   §4 with the same constants (gate `SyncTurn >= 20`, every 5th boundary,
   reset while pending, round to 10, cap 150, frames `[4, 20]`, 250 ms
   floor, ±10 ms dead band, step-down damping) and tags the change with
   `E = T + 2`; clients switch from turn `E + 1`. Putting `(G, F)` in the
   batch for turn `E` (which every client must hold before finishing turn
   `E`) gives the same "known one turn early" guarantee as §5.
3. **Latency input.** The original's `H` is the peer-to-peer round trip.
   Through a relay the path A → server → B → server → A costs
   `rtt(A) + rtt(B)`; the server measures each client's RTT to itself with
   its own ping every 8 s, sums the two, clamps to `[30, 6000]`, rounds to
   centiseconds, and uses that as `H`.
4. **Frame-time input.** Each client reports, with its turn acknowledgement,
   the mean of its last 50 "stepping frame" intervals (§3.2), as an integer
   ms capped at 255. The server uses the max over players (floor 10) as `A`.
   Browsers render at the display rate, so `A` will often be 16–17 ms
   (example 7.4).
5. **Client pacing.** After a boundary, release buffer step `k` only when
   wall time since the boundary is ≥ `k · G`; take the boundary step only
   when the next turn's batch from the server (the ack) is in hand. This
   reproduces the original's turn wall length (`(F − 1) · G` + one frame),
   not `(F + 1) · G`.
6. **Command delay stays 2 turns** (`COMMAND_DELAY_TURNS`); it never adapts.
   Responsiveness comes from shorter turns: ≈ 0.4 s average click-to-action
   on LAN-like links once adjusted, versus 1–2 s (≈ 1.5 s average) with
   990 ms wall turns.
7. **Determinism check.** Since `G` changes `world_time` per step, any
   replay or golden recording must record the `(turn, G, F)` changes with
   the commands.

### 8.1 Where the port does this

- Sim (`packages/sim/src/world.ts`): `World.granularity` / `frames` are the
  current `G` / `F`; `setSpeedChange({ turn: E, granularity, frames })`
  schedules a change, which the boundary step of turn `E + 1` applies
  (`runStep` runs one step, `runTurn` a whole turn). Pending changes are not
  hashed: peers may learn of one at different turns before it applies.
  `ReplayLog.speeds` records them (item 7).
- Wire (`packages/protocol`): a client sends the batch of commands issued
  during turn `N` once it has run `N` (they execute on `N + 2`), with its
  `frameMs`; the boundary step of `N + 2` waits for the server's release of
  `N`. The server pings (`ping` / `pong`) and reports round trips (`rtt`);
  every released `turn` carries each slot's last `frameMs` (the score
  display's slow icon, hud.md).
- Server (`apps/server/src/speed.ts`, `rooms.ts`): releasing turn `N` means
  every client has run it, which is the host's boundary `T = N + 1`;
  `SpeedHost.boundary` runs §4 there and the change for `E = T + 2` rides on
  that release as `speed`. Clients hand it to the sim with the batch at the
  boundary of `N + 2 = E − 1`, two turns before it applies.
- Client (`apps/client/src/lockstep/lockstep.ts`): item 5 pacing; a late loop
  runs every step that is due in one pass. Frame time is the mean of the
  last 50 `requestAnimationFrame` intervals (`frame-clock.ts`), so it rises
  with rendering cost and machine load, and `G` with it, as in the original.
  `?debug=net` shows `G`, `F`, the frame time and the round trips.

## 9. Protocol: a broken socket, a dropped player, a player who quits

What the original does with a player it stops hearing from (decomp), then
how the relay reproduces it (port).

**Original.** Every machine checks how long it has not heard from each other
player (`TCommunications_Handler`, `src/com_hand.cpp:540-575`). After 25 s it
notifies `COMM_PLAYER_NOT_RESPONDING`, shown as "Problem communicating with
%s..." (`STRING_ID_ERROR_COMMUNICATION` 1217) with game sound 2, and again
every 25 s; the game itself simply waits, because the next turn cannot run
without that player's "turn done". A non-host player that stays silent
`0x1D6B4` ms (120.5 s) is kicked; every machine then runs
`command_resign(player, 1)` on `COMM_OTHER_PLAYER_DROPPED`
(`RGE_Base_Game::handle_user_command`, `src/basegame.cpp:2903`), which the
game screen shows as "%s disconnected." (3012). Quit Game in a multiplayer
game (`do_game_over` -> `disconnect_multiplayer_game`,
`src/tribegam.cpp:4293`) first sends `SendIResignMsg`: a resign that executes
on `current_turn + CommandTurnIncrement` on every machine
(`CheckPlayerStopTurn` -> `COMM_PLAYER_RESIGNED` -> `command_resign(player, 0)`,
"%s resigned." 3013), then waits up to 15 s for its messages to go out. The
original has no way back into a game once the link is gone.

**Port.** Messages are in `packages/protocol/src/messages.ts`; the relay is
`apps/server/src/rooms.ts`; the client side is `apps/client/src/net/link.ts`
and `lockstep/lockstep.ts`.

1. `start` gives each client a secret `token` along with its slot.
2. A socket that breaks (close code 1006) or that the client closes as a
   drop (code >= 4000; `Link.drop`, `?debug=net` `window.__game.dropLink`)
   does not leave the room: the member is *away*, its slot held. A clean
   close (1000/1001) or `leave` still ends the game for the other player
   (`ended peer-left`), except after item 6.
3. While a game runs the client's link reconnects every 1 s
   (`RETRY_MS`) for up to `DROP_AFTER_MS` + 10 s, and its first message on
   the new socket is `rejoin {code, slot, token, received}`, `received` being
   the number of released turns it already has. The server answers
   `rejoined {nextTurn}` (the next turn it expects from that slot), then
   every released turn from `received` on, then `rtt`, then a ping. The
   client sends again each batch of turn >= `nextTurn` it had sent but not
   seen released (they may have been lost with the socket), and runs the
   missed turns as fast as they are due. A wrong token, a dropped slot or a
   room that is gone gets `error bad-rejoin`; the client then ends its game
   as dropped (`STRING_ID_PLAYER_DROPPED_NOTICE`, OK opens the achievements).
4. Meanwhile the other client's loop waits on the turn it lacks, as the
   original does; after 25 s (`NOT_RESPONDING_MS`) and every 25 s it shows
   "Problem communicating with %s..." with sound 2. The relay cannot tell
   which slot is late, so it names every other player still playing (exact
   with two players).
5. A member away `DROP_AFTER_MS` (120.5 s) after the server last heard from
   it is dropped: the server broadcasts `dropped {slot}`, puts a `resign` in
   that slot's next batch and fills its batches (empty) from then on;
   hashes from a dropped slot are ignored. Clients show "%s disconnected."
   for a player resigned after `dropped`. A room with nobody connected is
   closed.
6. Quit Game while the game is on: the client sends the batch of the turn
   under way at once with a `resign` appended (`Lockstep.quit`), then
   `leave`. A member that has submitted a `resign` and leaves (or closes
   cleanly) is not an "opponent left": the server marks it dropped and fills
   its batches, so the resign executes two turns later on the other client,
   which wins and shows "%s resigned.". After the game is over the quitting
   client sends no resign.

### 9.1 Sync check in the port

The original exchanges checksums every 4 turns (`com_sync.cpp:132`); a mismatch is `COMM_SYNC_ERROR`, which
`tribegam.cpp` `case 0x17b0` answers with sound 2 and the system message "Out of sync detected by comm..." on the game
screen (the host also saves the game; the popup `STRING_ID_ERROR_SYNC` and a loss only come with the `SKIPSYNCSAVE`
argument). The port checks at the same cadence: `Lockstep.endTurn` sends `hash {turn}` on every turn that is a multiple of
`SYNC_INTERVAL_TURNS` (4), including turn 0, just before the batch of `turn`, so the relay gets a player's hash before it
has released that turn; on the other turns nothing is sent. A divergence is therefore reported up to 3 turns after it
starts. The value is `World.syncChecksum()`, not the deep `World.hash()`: like the original's `GetWorldChecksums`
(`basegame.cpp:3699`, `RGE_Player::get_checksums`, `player.cpp:801`) it is a cheap summary (the clock, the random seed,
the stockpiles, techs and victory state, and each object's id, owner, type, position, hit points, state and load; 0.3 ms
against 8-25 ms on a Large map, which had dropped a frame at every turn end). `hash()` stays for replays and snapshots.
`rooms.ts` `reportHash` accepts a hash for any turn up to the member's `nextTurn` and holds it until every other
connected member has reported that turn; a mismatch is broadcast as `desync {turn, hashes}`. The client stops its loop and shows the system message
(`GameHud.outOfSync`), keeping the game screen; Menu still works.
