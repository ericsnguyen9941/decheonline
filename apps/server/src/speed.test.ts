import { describe, expect, test } from 'vitest';
import type { SpeedChange } from '@aoe/protocol';
import { chooseSpeed, highLatencyMs, SpeedHost } from './speed';

/** Run boundaries 0..`last` with fixed inputs; the changes agreed on the way, with the boundary that agreed each. */
function run(host: SpeedHost, last: number, frameMs: number, latencyMs: number): { at: number; change: SpeedChange }[] {
  const out: { at: number; change: SpeedChange }[] = [];
  for (let t = 0; t <= last; t++) {
    const change = host.boundary(t, frameMs, latencyMs);
    if (change) out.push({ at: t, change });
  }
  return out;
}

describe('docs/spec/turn-timing.md §7 worked examples', () => {
  test('7.1 LAN, 10 ms RTT: G 30, F 9 agreed at boundary 22 for turn 24, then steady', () => {
    const latency = highLatencyMs(10);
    expect(latency).toBe(30);
    const host = new SpeedHost();
    expect(run(host, 60, 30, latency)).toEqual([{ at: 22, change: { turn: 24, granularity: 30, frames: 9 } }]);
    expect([host.granularity, host.frames]).toEqual([30, 9]);
  });

  test('7.2 internet, 120 ms RTT: the same G 30, F 9 as the LAN', () => {
    const latency = highLatencyMs(120);
    expect(latency).toBe(120);
    const host = new SpeedHost();
    expect(run(host, 60, 30, latency)).toEqual([{ at: 22, change: { turn: 24, granularity: 30, frames: 9 } }]);
    expect([host.granularity, host.frames]).toEqual([30, 9]);
  });

  test('7.3 slow machine, 400 ms RTT: frames step down one per adjustment, 6 turns apart', () => {
    const host = new SpeedHost();
    expect(run(host, 60, 70, highLatencyMs(400))).toEqual([
      { at: 22, change: { turn: 24, granularity: 70, frames: 9 } },
      { at: 28, change: { turn: 30, granularity: 70, frames: 8 } },
      { at: 34, change: { turn: 36, granularity: 70, frames: 7 } },
    ]);
  });

  test('7.4 17 ms frames, 10 ms RTT: G 20, F 9 under the floor for one period, then F 13 with no damping upwards', () => {
    const host = new SpeedHost();
    expect(run(host, 60, 17, highLatencyMs(10))).toEqual([
      { at: 22, change: { turn: 24, granularity: 20, frames: 9 } },
      { at: 28, change: { turn: 30, granularity: 20, frames: 13 } },
    ]);
  });
});

describe('speed choice', () => {
  test('granularity rounds to 10 ms, capped at 150, and keeps G inside the 10 ms band', () => {
    // 150 · 4 = 600 is 300 below 900: damped to F − 1.
    expect(chooseSpeed({ granularity: 90, frames: 10 }, 400, 30)).toEqual({ granularity: 150, frames: 9 });
    expect(chooseSpeed({ granularity: 30, frames: 9 }, 34, 30)).toBeNull();
    expect(chooseSpeed({ granularity: 30, frames: 9 }, 45, 30)).toEqual({ granularity: 50, frames: 6 });
  });

  test('frames: H / g + 2 within [4, 20], then the 250 ms floor', () => {
    expect(chooseSpeed({ granularity: 50, frames: 5 }, 50, 400)).toEqual({ granularity: 50, frames: 10 });
    expect(chooseSpeed({ granularity: 50, frames: 10 }, 50, 2550)).toEqual({ granularity: 50, frames: 20 });
    // No frame time reported yet: the floor of 10 ms gives 26 frames, past the clamp, as the original does.
    expect(chooseSpeed({ granularity: 10, frames: 9 }, 0, 30)).toEqual({ granularity: 10, frames: 26 });
  });

  test('no change within the 10 ms dead band', () => {
    expect(chooseSpeed({ granularity: 30, frames: 9 }, 30, 30)).toBeNull();
    expect(chooseSpeed({ granularity: 20, frames: 13 }, 17, 30)).toBeNull();
  });

  test('round trips clamp to [30, 6000] ms and centiseconds to 255', () => {
    expect([0, 34, 35, 120, 2549, 9000].map(highLatencyMs)).toEqual([30, 30, 40, 120, 2550, 2550]);
  });

  test('a change in latency mid-game is picked up at the next analysis', () => {
    const host = new SpeedHost();
    run(host, 40, 17, highLatencyMs(10));
    expect([host.granularity, host.frames]).toEqual([20, 13]);
    expect(host.boundary(41, 17, highLatencyMs(600))).toEqual({ turn: 43, granularity: 20, frames: 20 });
    expect(host.boundary(42, 17, highLatencyMs(600))).toBeNull();
    expect(host.boundary(43, 17, highLatencyMs(600))).toBeNull();
    expect([host.granularity, host.frames]).toEqual([20, 20]);
  });
});
