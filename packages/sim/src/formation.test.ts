import { describe, expect, test } from 'vitest';
import { parseCommand, type Command } from './commands';
import { TileMap } from './map';
import { CLUBMAN, VILLAGER } from './units';
import { VICTORY_SPECIAL } from './victory';
import { World, type StartUnit } from './world';

/** Player 1's Clubmen: the first nearest the origin (the reference), the others in a row far from it. */
const UNITS: StartUnit[] = [
  { owner: 1, type: CLUBMAN, x: 10.5, y: 10.5 },
  { owner: 1, type: CLUBMAN, x: 30.5, y: 30.5 },
  { owner: 1, type: CLUBMAN, x: 31.5, y: 30.5 },
  { owner: 1, type: CLUBMAN, x: 32.5, y: 30.5 },
  { owner: 1, type: CLUBMAN, x: 33.5, y: 30.5 },
];

function world(units: StartUnit[] = UNITS): World {
  return new World({ players: 3, map: new TileMap(64, 64), units, victory: { type: VICTORY_SPECIAL } });
}

/** Run until the command has executed (2 turns later). */
function order(w: World, player: number, command: Command): void {
  w.addBatch(w.turn, player, [command]);
  for (let i = 0; i < 3; i++) w.runTurn();
}

/** Each unit's move goal once the command ran, or null for one with no walk. */
function goals(w: World, ids: number[]): ([number, number] | null)[] {
  return ids.map((id) => {
    const a = w.entities.get(id)!.mover!.action;
    return a ? [a.x, a.y] : null;
  });
}

describe('commands.md §6: formations (RGE_Command::do_command_formation)', () => {
  test('parse: formations 0-5 with one unit or more', () => {
    expect(parseCommand({ type: 'formation', units: [1, 2], formation: 5, extra: 1 })).toEqual({ type: 'formation', units: [1, 2], formation: 5 });
    expect(parseCommand({ type: 'formation', units: [1, 2], formation: 6 })).toBeNull();
    expect(parseCommand({ type: 'formation', units: [1, 2], formation: -1 })).toBeNull();
    expect(parseCommand({ type: 'formation', units: [], formation: 0 })).toBeNull();
  });

  // Reference (10.5, 10.5); x steps `adjustedYLocation`, y steps `tempX`, from 1 (formation 0), 2 (2, 3) or 1.5 (1, 4, 5).
  test.each([
    [0, [[11.5, 11.5], [12.5, 12.5], [13.5, 13.5], [14.5, 14.5]]],
    [1, [[12, 9], [13.5, 7.5], [15, 6], [16.5, 4.5]]],
    [2, [[12.5, 10.5], [14.5, 10.5], [16.5, 10.5], [18.5, 10.5]]],
    [3, [[10.5, 12.5], [10.5, 14.5], [10.5, 16.5], [10.5, 18.5]]],
    [4, [[12, 9], [12, 12], [13.5, 7.5], [13.5, 13.5]]],
    [5, [[9, 9], [9, 12], [7.5, 7.5], [7.5, 13.5]]],
  ])('formation %i: the others walk to their places off the unit nearest the origin, which stays', (formation, expected) => {
    const w = world();
    order(w, 1, { type: 'formation', units: [2, 3, 1, 4, 5], formation });
    expect(goals(w, [1, 2, 3, 4, 5])).toEqual([null, ...expected]);
    for (const id of [1, 2, 3, 4, 5]) {
      const m = w.entities.get(id)!.mover!;
      expect(m.group).toEqual([2, 3, 1, 4, 5].filter((other) => other !== id));
    }
    const ai = w.entities.get(2)!.ai!;
    expect([ai.targetX, ai.targetY, ai.targetZ]).toEqual([expected[0]![0], expected[0]![1], 1]);
  });

  test('the line (formation 2) forms: every unit stops in range of its place', () => {
    const w = world();
    order(w, 1, { type: 'formation', units: [1, 2, 3, 4, 5], formation: 2 });
    for (let i = 0; i < 40; i++) w.runTurn();
    const places = [10.5, 12.5, 14.5, 16.5, 18.5];
    [1, 2, 3, 4, 5].forEach((id, i) => {
      const e = w.entities.get(id)!;
      // Coming from below, each stops once its edge is in range: on its column, under 0.7 short of the line.
      expect([e.x, e.mover!.speed]).toEqual([places[i], 0]);
      expect(Math.abs(e.y - 10.5)).toBeLessThan(0.7);
    });
  });

  test("one unit does nothing; another player's units are skipped and do not take a place", () => {
    const w = world([...UNITS, { owner: 2, type: VILLAGER, x: 5.5, y: 5.5 }]);
    order(w, 1, { type: 'formation', units: [2], formation: 0 });
    expect(goals(w, [2])).toEqual([null]);
    order(w, 1, { type: 'formation', units: [6, 2, 3, 1], formation: 2 });
    expect(goals(w, [6, 1, 2, 3])).toEqual([null, null, [12.5, 10.5], [14.5, 10.5]]);
  });

  test('the command replays to the same hashes and survives a snapshot', () => {
    const a = world();
    a.addBatch(a.turn, 1, [{ type: 'formation', units: [1, 2, 3, 4, 5], formation: 4 }]);
    const b = World.restore(JSON.parse(JSON.stringify(a.snapshot())));
    expect(b.hash()).toBe(a.hash());
    for (let i = 0; i < 10; i++) {
      a.runTurn();
      b.runTurn();
      expect(b.hash()).toBe(a.hash());
    }
  });
});
