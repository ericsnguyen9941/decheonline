import { describe, expect, test } from 'vitest';
import type { Command } from './commands';
import { RELATION_ALLY } from './diplomacy';
import { ObjectState, type Entity } from './entities';
import { typeOf } from './masters';
import { isEnabled } from './techs';
import { BUILDER, TOWN_CENTER, VILLAGER } from './units';
import { END_WONDER, STATUS_LOST, STATUS_PLAYING, STATUS_WON, VICTORY_SCORE, VICTORY_STANDARD, type VictorySettings } from './victory';
import { TILE_VISIBLE } from './visibility';
import { WONDER, WONDER_COUNTING, WONDER_WAITING } from './wonder';
import { AGE_IRON, World, type Snapshot, type StartUnit } from './world';

const WOOD = 1;
const STONE = 2;
const GOLD = 3;
/** Attribute 42, standing wonders (victory.md §8, §11.2 ID 23). */
const ATTR_WONDERS = 42;

/** A Town Center each, so nobody is out; player 1's Wonder in the middle when `wonder`. */
function units(players: number, wonder: boolean): StartUnit[] {
  const out: StartUnit[] = [
    { owner: 1, type: TOWN_CENTER, x: 5.5, y: 5.5 },
    { owner: 2, type: TOWN_CENTER, x: 40.5, y: 8.5 },
  ];
  if (players > 3) out.push({ owner: 3, type: TOWN_CENTER, x: 8.5, y: 40.5 });
  if (wonder) out.push({ owner: 1, type: WONDER, x: 22.5, y: 12.5 });
  return out;
}

function world(victory: VictorySettings = { type: VICTORY_STANDARD }, players = 3, wonder = true): World {
  return new World({ players, units: units(players, wonder), victory });
}

const wonders = (w: World) => [...w.entities.all()].filter((e) => e.type === WONDER);
const visible = (w: World, p: number, e: Entity) => w.tileVisibility(p, Math.trunc(e.x), Math.trunc(e.y)) === TILE_VISIBLE;

function order(w: World, player: number, command: Command): void {
  w.addBatch(w.turn, player, [command]);
  for (let i = 0; i < 3; i++) w.runTurn();
}

/** Steps until the game is over, at most `limit`. */
function stepsToEnd(w: World, limit = 12000): number {
  let steps = 0;
  while (!w.gameOver && steps < limit) {
    w.runStep();
    steps++;
  }
  return steps;
}

describe('victory.md §8: the Wonder (unit 276) in the dat', () => {
  test('1000 wood, stone and gold, 8000 build points, built by Villagers (location 118), not enabled at start', () => {
    const w = world();
    const t = w.masters[1]![WONDER]!;
    expect(t.creatable!.costs.filter((c) => c.flag === 1).map((c) => [c.type, c.amount])).toEqual([[GOLD, 1000], [STONE, 1000], [WOOD, 1000]]);
    expect([t.creatable!.trainTime, t.creatable!.trainLocationId, t.hitPoints]).toEqual([8000, BUILDER, 500]);
    expect(t.action!.tasks.map((k) => [k.actionType, k.isDefault])).toEqual([[120, 1]]);
    expect(isEnabled(w, 1, WONDER)).toBe(false);
  });

  test('enabled by the Iron Age: a Villager places it, paying 1000 of each, and it waits as a foundation (state 2)', () => {
    const w = new World({
      players: 3,
      startingAge: AGE_IRON,
      units: [...units(3, false), { owner: 1, type: VILLAGER, x: 30.5, y: 17.5 }, { owner: 1, type: VILLAGER, x: 30.5, y: 25.5 }],
      victory: { type: VICTORY_STANDARD },
    });
    expect(isEnabled(w, 1, WONDER)).toBe(true);
    for (const r of [WOOD, STONE, GOLD]) w.attributes[1]![r] = 1500;
    const villager = [...w.entities.ofPlayer(1)].find((e) => e.type === VILLAGER)!;
    order(w, 1, { type: 'build', units: [villager.id], unitType: WONDER, x: 30.5, y: 21.5 });
    const [site] = wonders(w);
    expect([WOOD, STONE, GOLD].map((r) => w.attributes[1]![r])).toEqual([500, 500, 500]);
    expect([site!.state, site!.wonder]).toEqual([ObjectState.Unbuilt, { state: WONDER_WAITING, timer: 0 }]);
    // `set_state(2)`: the site shows on the other player's map (its footprint) from the start.
    expect(visible(w, 2, site!)).toBe(true);
    expect(w.victory.wonderCountdown).toEqual([-1, -1, -1]);
  });
});

describe('victory.md §8 / Example 1: the countdown (src/tact_wnd.cpp)', () => {
  test('Standard: active in step 1 (state 6, countdown 2000), then 1999 ..., won 11110 steps later with end condition 100', () => {
    const w = world();
    const [wonder] = wonders(w);
    expect(wonder!.wonder!.state).toBe(WONDER_WAITING);
    w.runStep();
    expect([wonder!.wonder, w.victory.wonderCountdown[1]]).toEqual([{ state: WONDER_COUNTING, timer: 0 }, 2000]);
    // Attribute 42 came with the building's completion (its flag-4 storage): 100 points.
    expect([w.attributes[1]![ATTR_WONDERS], w.score(1).wonder]).toEqual([1, 100]);
    w.runStep();
    expect(w.victory.wonderCountdown[1]).toBe(1999);
    expect(1 + stepsToEnd(w)).toBe(11110);
    expect(wonder!.wonder!.timer).toBe(2000.054931640625);
    expect(w.victory.wonderCountdown[1]).toBe(0);
    expect(w.gameResult()).toEqual({ endCondition: END_WONDER, winners: [1], status: [0, STATUS_WON, STATUS_LOST] });
  });

  test("the completed Wonder's sight shows on the other player's map; the site's footprint gives way to it", () => {
    const w = world();
    const [wonder] = wonders(w);
    expect(visible(w, 2, wonder!)).toBe(true);
    expect(w.tileVisibility(2, 22 + 4, 12)).not.toBe(TILE_VISIBLE);
    w.runStep();
    expect(w.tileVisibility(2, 22 + 4, 12)).toBe(TILE_VISIBLE);
  });

  test('destroyed: the countdown clears (-1), the sight goes, and the game goes on past 11110 steps', () => {
    const w = world();
    for (let i = 0; i < 1000; i++) w.runStep();
    const [wonder] = wonders(w);
    expect(w.victory.wonderCountdown[1]).toBe(1820);
    wonder!.hp = 0;
    w.runStep();
    expect(wonder!.state).toBeGreaterThanOrEqual(ObjectState.Dying);
    expect([wonder!.wonder, w.victory.wonderCountdown[1]]).toEqual([null, -1]);
    expect(visible(w, 2, wonder!)).toBe(false);
    expect(stepsToEnd(w, 11000)).toBe(11000);
    expect(w.victory.status).toEqual([0, STATUS_PLAYING, STATUS_PLAYING]);
  });

  test('a new Wonder counts from 0; with two, the clock shows the lower, and 2000 the step the older one falls', () => {
    const w = world();
    for (let i = 0; i < 1000; i++) w.runStep();
    const second = w.createUnit({ owner: 1, type: WONDER, x: 22.5, y: 30.5 });
    w.runStep();
    expect(second.wonder).toEqual({ state: WONDER_COUNTING, timer: 0 });
    expect(w.victory.wonderCountdown[1]).toBe(1820);
    const [first] = wonders(w);
    first!.hp = 0;
    w.runStep();
    expect(w.victory.wonderCountdown[1]).toBe(2000);
    w.runStep();
    expect(w.victory.wonderCountdown[1]).toBe(1999);
    expect(w.attributes[1]![ATTR_WONDERS]).toBe(1);
  });

  test('outside Standard the timer runs to 2000 and stops, but nothing is shown and nobody wins', () => {
    const w = world({ type: VICTORY_SCORE, amount: 100000 });
    const [wonder] = wonders(w);
    for (let i = 0; i < 11200; i++) w.runStep();
    expect([wonder!.wonder!.timer, w.victory.wonderCountdown[1], w.gameOver]).toEqual([2000.054931640625, -1, false]);
  });

  test('allied victory: the holder and its mutual ally with allied victory win, the third player loses', () => {
    const w = world({ type: VICTORY_STANDARD }, 4);
    for (const [p, q] of [[1, 2], [2, 1]] as const) {
      w.addBatch(w.turn, p, [{ type: 'relation', player: q, relation: RELATION_ALLY }, { type: 'allied-victory', on: true }]);
    }
    // The completion step, then 11110 increments.
    expect(stepsToEnd(w)).toBe(1 + 11110);
    expect(w.gameResult()).toEqual({ endCondition: END_WONDER, winners: [1, 2], status: [0, STATUS_WON, STATUS_WON, STATUS_LOST] });
  });

  test('the stop command deletes the action (countdown cleared); the next update starts it again from 0', () => {
    const w = world();
    for (let i = 0; i < 1000; i++) w.runStep();
    const [wonder] = wonders(w);
    order(w, 1, { type: 'stop', objects: [wonder!.id] });
    expect(wonder!.wonder!.state).toBe(WONDER_COUNTING);
    expect(w.victory.wonderCountdown[1]).toBeGreaterThan(1990);
  });

  test('a snapshot keeps the action and the countdown', () => {
    const w = world();
    for (let i = 0; i < 10; i++) w.runTurn();
    const copy = World.restore(JSON.parse(JSON.stringify(w.snapshot())) as Snapshot);
    expect(copy.hash()).toBe(w.hash());
    for (let i = 0; i < 10; i++) {
      w.runTurn();
      copy.runTurn();
    }
    expect(copy.hash()).toBe(w.hash());
    expect(typeOf(copy, wonders(copy)[0]!).id).toBe(WONDER);
    expect(copy.victory.wonderCountdown[1]).toBe(w.victory.wonderCountdown[1]);
  });
});
