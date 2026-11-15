import { describe, expect, test } from 'vitest';
import { parseCommand, type Command } from './commands';
import { ObjectState, type Entity } from './entities';
import { f32, MS_TO_SECONDS, mul32 } from './num';
import { CLUBMAN, HOUSE, SMALL_WALL, VILLAGER } from './units';
import {
  checkGameState,
  END_CONDITIONS,
  END_CONQUEST,
  END_TIME_LIMIT,
  newVictory,
  perSecond,
  scoreOf,
  STATUS_LOST,
  STATUS_PLAYING,
  STATUS_WON,
  updateConditions,
  VICTORY_SCORE,
  VICTORY_SPECIAL,
  VICTORY_STANDARD,
  VICTORY_TIME_LIMIT,
  type VictorySettings,
} from './victory';
import { startingObjects, STEP_MS, World, type StartUnit } from './world';

/** `world_time_delta_seconds` at the default 90 ms step: 0.09000000357627869. */
const DT = mul32(STEP_MS, MS_TO_SECONDS);

function world(units: StartUnit[], victory: VictorySettings = { type: VICTORY_STANDARD }): World {
  return new World({ players: 3, units, victory });
}

function order(w: World, player: number, command: Command): void {
  w.addBatch(w.turn, player, [command]);
  for (let i = 0; i < 3; i++) w.runTurn();
}

/** Run single steps until `done`; returns how many ran. */
function stepsUntil(w: World, done: () => boolean, limit: number): number {
  let steps = 0;
  while (!done() && steps < limit) {
    w.runStep();
    steps++;
  }
  expect(done()).toBe(true);
  return steps;
}

const villager = (owner: number, x: number, y: number): StartUnit => ({ owner, type: VILLAGER, x, y });

describe('victory.md Example 5: elimination timing', () => {
  test('from game start the per-second block runs in steps 12, 23, 34, 45, 56', () => {
    const w = world([villager(1, 10.5, 10.5), villager(2, 30.5, 30.5)]);
    const ticks: number[] = [];
    let last = 0;
    for (let step = 1; step <= 56; step++) {
      w.runStep();
      if (w.playerUpdateTime[2]! < last) ticks.push(step);
      last = w.playerUpdateTime[2]!;
    }
    expect(ticks).toEqual([12, 23, 34, 45, 56]);
    expect(w.gameOver).toBe(false);
  });

  test('a player with no objects loses in step 12, the first tick; the opponent wins in that step', () => {
    const w = world([villager(1, 10.5, 10.5)]);
    expect(stepsUntil(w, () => w.gameOver, 100)).toBe(12);
    expect(w.gameResult()).toEqual({ endCondition: END_CONQUEST, winners: [1], status: [0, STATUS_WON, STATUS_LOST] });
    expect(w.attributes[2]![45]).toBe(0);
    expect(w.score(2).survival).toBe(0);
    expect(w.score(1).survival).toBe(100);
  });

  test("P2's last villager dies in step K with update_time 0.5: defeated in step K+5, P1 wins with end condition 1", () => {
    const w = world([villager(1, 10.5, 10.5), villager(2, 30.5, 30.5), { owner: 2, type: SMALL_WALL, x: 33.5, y: 30.5 }]);
    w.playerUpdateTime[2] = f32(0.5);
    const last = [...w.entities.all()].find((e) => e.owner === 2 && e.type === VILLAGER)!;
    last.hp = 0;
    w.runStep(); // step K: the villager starts dying
    expect(last.state).toBeGreaterThanOrEqual(ObjectState.Dying);
    // update_time after steps K..K+4; no tick yet.
    for (const expected of [0.5900000334, 0.6800000668, 0.7700001001, 0.8600001335, 0.9500001669]) {
      expect(w.playerUpdateTime[2]).toBeCloseTo(expected, 9);
      expect(w.playerStatus(2)).toBe(STATUS_PLAYING);
      w.runStep();
    }
    // K+5: update_time 1.0400002003 > 1, the per-second block finds only a wall (group 27).
    expect(w.playerUpdateTime[2]).toBeCloseTo(0.0400002003, 9);
    expect(w.playerStatus(2)).toBe(STATUS_LOST);
    expect(w.gameResult()).toEqual({ endCondition: END_CONQUEST, winners: [1], status: [0, STATUS_WON, STATUS_LOST] });
  });

  test('walls and pending foundations do not keep a player alive; one active house does', () => {
    const walls = world([villager(1, 10.5, 10.5), { owner: 2, type: SMALL_WALL, x: 30.5, y: 30.5 }]);
    expect(stepsUntil(walls, () => walls.gameOver, 100)).toBe(12);
    expect(walls.gameResult()!.winners).toEqual([1]);

    // A House foundation, never built.
    const foundation = world([villager(1, 10.5, 10.5)]);
    const house = foundation.createObject(2, HOUSE, 31, 31, 0);
    expect(house.state).toBe(ObjectState.Unbuilt);
    expect(stepsUntil(foundation, () => foundation.gameOver, 100)).toBe(12);
    expect(house.state).toBe(ObjectState.Unbuilt);
    expect(foundation.gameResult()!.winners).toEqual([1]);

    const built = world([villager(1, 10.5, 10.5), { owner: 2, type: HOUSE, x: 31, y: 31 }]);
    for (let i = 0; i < 20; i++) built.runTurn();
    expect(built.gameOver).toBe(false);
    expect(built.victory.status).toEqual([0, 0, 0]);
  });

  test('a player whose last units and buildings die in combat is defeated and the game stops', () => {
    // P2's lone Villager next to two P1 Clubmen that are ordered to attack it.
    const w = world([...startingObjects(2).filter((u) => u.owner !== 0), { owner: 1, type: CLUBMAN, x: 20.5, y: 20.5 }, { owner: 1, type: CLUBMAN, x: 21.5, y: 20.5 }, villager(2, 22.5, 21.5)]);
    const target = [...w.entities.all()].find((e) => e.owner === 2)!;
    const clubmen = [...w.entities.all()].filter((e) => e.type === CLUBMAN).map((e) => e.id);
    order(w, 1, { type: 'attack', units: clubmen, target: target.id });
    for (let i = 0; i < 60 && !w.gameOver; i++) w.runTurn();
    expect(w.gameResult()).toEqual({ endCondition: END_CONQUEST, winners: [1], status: [0, STATUS_WON, STATUS_LOST] });
    expect(w.attributes[1]![20]).toBe(1);
    const time = w.worldTime;
    const hash = w.hash();
    w.runTurn();
    expect(w.worldTime).toBe(time);
    expect(w.hash()).not.toBe(hash); // only the turn counters move
  });
});

describe('resign', () => {
  test('parses from the wire', () => {
    expect(parseCommand({ type: 'resign', extra: 1 })).toEqual({ type: 'resign' });
  });

  test('resign ends the game for both: the sender loses, the other wins in the same step', () => {
    const w = world(startingObjects(3));
    order(w, 1, { type: 'resign' });
    expect(w.gameResult()).toEqual({ endCondition: END_CONQUEST, winners: [2], status: [0, STATUS_LOST, STATUS_WON] });
    expect(w.victory.resigned).toEqual([false, true, false]);
    const time = w.worldTime;
    for (let i = 0; i < 5; i++) w.runTurn();
    expect(w.worldTime).toBe(time);
  });

  test('both resigning in the same turn: game over with no winner', () => {
    const w = world(startingObjects(3));
    w.addBatch(0, 1, [{ type: 'resign' }]);
    w.addBatch(0, 2, [{ type: 'resign' }]);
    for (let i = 0; i < 3; i++) w.runTurn();
    expect(w.gameResult()).toEqual({ endCondition: END_CONQUEST, winners: [], status: [0, STATUS_LOST, STATUS_LOST] });
  });

  test('a resign issued by the other player is not on behalf of this one, and survives a snapshot', () => {
    const w = world(startingObjects(3));
    w.addBatch(0, 2, [{ type: 'resign' }]);
    w.runTurn();
    const restored = World.restore(JSON.parse(JSON.stringify(w.snapshot())) as ReturnType<World['snapshot']>);
    expect(restored.hash()).toBe(w.hash());
    for (let i = 0; i < 2; i++) restored.runTurn();
    expect(restored.gameResult()!.winners).toEqual([1]);
  });
});

describe('victory.md Example 4: score breakdown', () => {
  test('P1 scores 333: military 30, economy 45, religion 47, technology 111, survival 100', () => {
    const attrs = [0, 1, 2].map(() => new Array<number>(60).fill(0));
    const [, p1, p2] = attrs as [number[], number[], number[]];
    Object.assign(p1, { 20: 7, 43: 2, 19: 30, 11: 20, 40: 12, 49: 450, 53: 130, 37: 24, 41: 3, 14: 0, 7: 1, 52: 2, 21: 18, 6: 3, 45: 1 });
    Object.assign(p2, { 40: 9, 37: 26, 22: 52, 41: 1, 21: 15, 6: 2, 45: 1 });
    const v = newVictory(3);
    const alive = { state: ObjectState.Active } as Entity;
    perSecond(v, 1, { attributes: p1, exploredTiles: 2469, totalTiles: 72 * 72, objects: [alive], groupOf: () => 4 });
    expect(p1[22]).toBe(47.627315521240234);
    expect(p1[44]).toBe(0);
    updateConditions(v, 1, attrs);
    const points = Object.fromEntries(v.scores[1]!.map((e) => [e.id, e.currPoints]));
    expect(points).toEqual({
      0: 3, 1: 2, 2: 0, 3: 25, 4: 4, 9: 2, 5: 24, 6: 0, 7: 15, 8: 0, 10: 6, 11: 25, 12: 0, 13: 10, 14: 6, 15: 0, 16: 0,
      17: 36, 18: 50, 19: 25, 20: 0, 22: 100, 23: 0,
    });
    expect(scoreOf(v, 1)).toEqual({ total: 333, military: 30, economy: 45, religion: 47, technology: 111, survival: 100, wonder: 0 });
    // Lists run newest entry first (victory.md §4).
    expect(v.scores[1]![0]!.id).toBe(23);
    expect(v.scores[1]!.at(-1)!.id).toBe(0);
    expect(v.scores[0]).toEqual([]);
  });

  test('"first to Bronze" latches for the first player and is impossible for the later one', () => {
    const attrs = [0, 1, 2].map(() => new Array<number>(60).fill(0));
    const v = newVictory(3);
    attrs[1]![6] = 3;
    updateConditions(v, 1, attrs);
    attrs[2]![6] = 3;
    updateConditions(v, 2, attrs);
    attrs[1]![6] = 2; // an age undone does not take the points back
    updateConditions(v, 1, attrs);
    expect(v.scores[1]!.find((e) => e.id === 19)).toMatchObject({ state: 2, currPoints: 25 });
    expect(v.scores[2]!.find((e) => e.id === 19)).toMatchObject({ state: 1, currPoints: 0 });
  });
});

describe('victory.md Example 3: time limit', () => {
  for (const [years, decrements, clock] of [
    [3000, 16662, 0.9323726296424866],
    [15000, 83375, 0.8523479104042053],
  ] as const) {
    test(`${years} years: ${decrements} decrements to ${clock}; a 333-333 tie goes to P1`, () => {
      const v = newVictory(3, { type: VICTORY_TIME_LIMIT, amount: years });
      v.totals[1] = 333;
      v.totals[2] = 333;
      let steps = 0;
      while (v.gameState === 0) {
        checkGameState(v, DT);
        steps++;
      }
      expect(steps).toBe(decrements);
      expect(v.countdownClock).toBe(clock);
      expect(v.status).toEqual([0, STATUS_WON, STATUS_LOST]);
      expect(v.endCondition).toBe(END_TIME_LIMIT);
    });
  }

  test('in a world, the higher score wins when the clock runs out', () => {
    const w = world([villager(1, 10.5, 10.5), villager(2, 30.5, 30.5)], { type: VICTORY_TIME_LIMIT, amount: 10 });
    w.attributes[2]![21] = 5; // five techs: 10 points and the "most techs" 50
    let clock = f32(10);
    let decrements = 0;
    while (clock >= 1) {
      clock = f32(clock - mul32(DT, 2));
      decrements++;
    }
    expect(stepsUntil(w, () => w.gameOver, 200)).toBe(decrements);
    expect(w.victory.countdownClock).toBe(clock);
    expect(w.gameResult()).toEqual({ endCondition: END_TIME_LIMIT, winners: [2], status: [0, STATUS_LOST, STATUS_WON] });
    expect(w.score(2).total).toBeGreaterThan(w.score(1).total);
  });
});

test('score victory: reaching the points wins with end condition 2', () => {
  const w = world([villager(1, 10.5, 10.5), villager(2, 30.5, 30.5)], { type: VICTORY_SCORE, amount: 300 });
  w.attributes[1]![21] = 75;
  w.runStep();
  // 150 for the techs, 50 for the most techs, 100 survival, 1 + 25 for the civilian high.
  expect(w.score(1).total).toBe(326);
  expect(w.gameResult()).toEqual({ endCondition: END_CONDITIONS, winners: [1], status: [0, STATUS_WON, STATUS_LOST] });
});

test('civilians and military count from creation to removal (attributes 37 and 40)', () => {
  const units = [villager(1, 10.5, 10.5), villager(1, 11.5, 10.5), { owner: 1, type: CLUBMAN, x: 12.5, y: 10.5 }, { owner: 1, type: HOUSE, x: 15, y: 15 }];
  // P2 has nothing: conquest off, or the game would end at step 12.
  const w = world(units, { type: VICTORY_SPECIAL });
  expect(w.attributes[1]![37]).toBe(2);
  expect(w.attributes[1]![40]).toBe(1);
  const clubman = [...w.entities.all()].find((e) => e.type === CLUBMAN)!;
  order(w, 1, { type: 'cancel', target: clubman.id });
  // Still counted while dying and decaying; gone once the object is removed.
  expect(w.attributes[1]![40]).toBe(1);
  for (let i = 0; i < 40 && w.entities.get(clubman.id); i++) w.runTurn();
  expect(w.entities.get(clubman.id)).toBeUndefined();
  expect(w.attributes[1]![40]).toBe(0);
});
