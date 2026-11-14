import { BUFFER_FRAMES, COMMAND_DELAY_TURNS, STEP_MS, type SpeedChange } from '@aoe/protocol';

/** Step size `G` (ms) and buffer frames `F` of a turn. */
export interface Speed {
  granularity: number;
  frames: number;
}

/** No analysis before `SyncTurn = T + CTI` reaches this (src/com_spd.cpp:326-406). */
const FIRST_SYNC_TURN = 20;
/** Boundaries without a pending change between analyses. */
const ANALYSE_EVERY = 5;
const MAX_GRANULARITY = 150;
const MIN_FRAMES = 4;
const MAX_FRAMES = 20;
/** `F · G` never drops below this. */
const MIN_TURN_MS = 250;
const DEAD_BAND_MS = 10;
/** A drop of more than this comes down one frame per adjustment. */
const DAMPING_MS = 100;

/**
 * `HighLatencyCenti · 10` for a round trip (docs/spec/turn-timing.md §3.1, §3.3, §8.3): clamped to [30, 6000] ms,
 * rounded to centiseconds, which are clamped to [1, 255].
 */
export function highLatencyMs(roundTripMs: number): number {
  const ms = Math.min(6000, Math.max(30, Math.round(roundTripMs)));
  return Math.min(255, Math.max(1, Math.trunc((ms + 5) / 10))) * 10;
}

/**
 * Steps 4-8 of `AnalyzeGameSpeed` (docs/spec/turn-timing.md §4): the speed to change to from `current`, given the
 * slowest player's mean frame time `frameMs` and the highest round trip `latencyMs`, or null to keep it.
 */
export function chooseSpeed(current: Speed, frameMs: number, latencyMs: number): Speed | null {
  const a = Math.max(10, frameMs);
  const h = Math.max(30, latencyMs);
  let g = Math.min(MAX_GRANULARITY, Math.trunc((a + 5) / 10) * 10);
  if (Math.abs(g - current.granularity) < 10) g = current.granularity;
  let f = Math.min(MAX_FRAMES, Math.max(MIN_FRAMES, Math.trunc(h / g) + 2));
  if (g * f < MIN_TURN_MS) f = Math.trunc(MIN_TURN_MS / g) + 1;
  const next = g * f;
  const cur = current.frames * current.granularity;
  if (Math.abs(next - cur) <= DEAD_BAND_MS) return null;
  if (next < cur && cur - next > DAMPING_MS && current.frames > MIN_FRAMES) f = current.frames - 1;
  return { granularity: g, frames: f };
}

/**
 * The host's speed control (`RGE_Communications_Speed`): the relay server plays the host for every room
 * (docs/spec/turn-timing.md §8.2). Call `boundary` once per turn boundary, in order.
 */
export class SpeedHost {
  granularity = STEP_MS;
  frames = BUFFER_FRAMES;
  private pending: SpeedChange | null = null;
  private lastAdjusted = 0;

  /**
   * Boundary `T` (before `current_turn` is incremented): `AdjustLocalSpeed`, then `AnalyzeGameSpeed` with the
   * players' highest frame time and round trip. Returns the change agreed for turn `T + CTI`, or null.
   */
  boundary(turn: number, frameMs: number, latencyMs: number): SpeedChange | null {
    if (this.pending) {
      this.lastAdjusted = 0;
      if (turn >= this.pending.turn) {
        this.granularity = this.pending.granularity;
        this.frames = this.pending.frames;
        this.pending = null;
      }
      if (this.pending) return null;
    }
    const syncTurn = turn + COMMAND_DELAY_TURNS;
    if (syncTurn < FIRST_SYNC_TURN) return null;
    if (++this.lastAdjusted < ANALYSE_EVERY) return null;
    const speed = chooseSpeed(this, frameMs, latencyMs);
    if (!speed) return null;
    this.pending = { turn: syncTurn, ...speed };
    return { ...this.pending };
  }
}
