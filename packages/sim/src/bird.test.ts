import { describe, expect, test } from 'vitest';
import { ACTION_BIRD, defaultBirdTask, updateBird } from './bird';
import { typeOf } from './masters';
import { f32 } from './num';
import { CrtRand } from './rng';
import { ELEPHANT, GAZELLE, LION } from './units';
import { VICTORY_SPECIAL } from './victory';
import { World } from './world';

/** Gaia and one player with nothing: conquest off, so the game does not end. */
function world(type: number): World {
  return new World({ players: 2, units: [{ owner: 0, type, x: 20.5, y: 20.5 }], victory: { type: VICTORY_SPECIAL } });
}

describe('unit-ai.md §5.5: an animal wanders (RGE_Action_Bird, src/act_bird.cpp)', () => {
  test('the wander is the default task of the Gazelle and the Elephant, not of the Lion', () => {
    for (const [type, wanders] of [[GAZELLE, true], [ELEPHANT, true], [LION, false]] as const) {
      const w = world(type);
      const t = typeOf(w, w.entities.get(1)!);
      expect(defaultBirdTask(t) !== -1).toBe(wanders);
      w.runTurn();
      expect(!!w.entities.get(1)!.bird).toBe(wanders);
    }
  });

  test('a point draws x then y, rand() * map size / 0x7FFF, then a 5-15 s timer, and walks there with the move sprite', () => {
    const w = world(GAZELLE);
    w.runTurn();
    const e = w.entities.get(1)!;
    const a = e.bird!;
    const task = typeOf(w, e).action!.tasks[a.task]!;
    expect(task.actionType).toBe(ACTION_BIRD);
    // Back to state 3 with a known rand() state, then one update.
    const ctx = w.gameContext();
    const ref = new CrtRand();
    ctx.rng.srand(12345);
    ref.srand(12345);
    a.state = 3;
    a.timer = 0;
    updateBird(ctx, e, a);
    const x = Math.trunc((ref.rand() * w.map.width) / 0x7fff);
    const y = Math.trunc((ref.rand() * w.map.height) / 0x7fff);
    const timer = Math.trunc((ref.rand() * 10) / 0x7fff) + 5;
    expect([a.state, a.x, a.y, a.timer]).toEqual([4, f32(x), f32(y), f32(timer)]);
    expect([e.mover!.action!.x, e.mover!.action!.y]).toEqual([f32(x), f32(y)]);
    expect(e.sprite!.graphic).toBe((task.moving ?? typeOf(w, e).standing).graphic);
  });

  test('the sprite swaps between the move and work sprites when the timer runs out; once the walk ends it picks a new point', () => {
    const w = world(GAZELLE);
    w.runStep();
    const e = w.entities.get(1)!;
    const task = typeOf(w, e).action!.tasks[e.bird!.task]!;
    const graphics = [task.moving, task.proceeding].map((s) => (s ?? typeOf(w, e).standing).graphic);
    const seen = new Set<number>();
    let swaps = 0;
    let [points, arrivals] = [0, 0];
    let [state, x, y] = [e.bird!.state, e.bird!.x, e.bird!.y];
    for (let i = 0; i < 40000 && points < 4; i++) {
      w.runStep();
      const a = e.bird!;
      expect([3, 4, 6]).toContain(a.state);
      expect(a.timer).toBeLessThanOrEqual(15);
      // State 3 lasts until the next update: the walk is gone and the sprite is the one it had.
      if (a.state === 3) expect(e.mover?.action ?? null).toBeNull();
      else expect(e.sprite!.graphic).toBe(graphics[a.state === 4 ? 0 : 1]);
      seen.add(a.state);
      if (a.state !== state && a.state !== 3 && state !== 3) swaps++;
      if (a.x !== x || a.y !== y) {
        // Only once the walk is gone: arrived within the task's work range, or stopped short of a point it cannot reach.
        expect(state).toBe(3);
        if (Math.sqrt((e.x - x) ** 2 + (e.y - y) ** 2) < task.workRange + 1) arrivals++;
        points++;
      }
      [state, x, y] = [a.state, a.x, a.y];
    }
    expect(points).toBe(4);
    expect(arrivals).toBeGreaterThan(0);
    expect(swaps).toBeGreaterThan(0);
    expect([...seen].sort()).toEqual([3, 4, 6]);
  });
});
