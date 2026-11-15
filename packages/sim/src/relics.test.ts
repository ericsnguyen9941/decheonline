import { describe, expect, test } from 'vitest';
import type { Entity } from './entities';
import { typeOf } from './masters';
import { teleport } from './movement';
import { MS_TO_SECONDS, mul32 } from './num';
import { MAP_HILLY, MAP_LAKE, MAP_MOSTLY_LAND, MAP_SMALL, MAP_TINY } from './rmm-controller';
import { RELIC, RUIN } from './rmm-objects';
import { TOWN_CENTER, VILLAGER } from './units';
import {
  ATTR_ALL_ARTIFACTS,
  ATTR_ALL_RUINS,
  ATTR_ARTIFACTS,
  ATTR_RUINS,
  checkGameState,
  END_ALL_RELICS,
  END_ALL_RUINS,
  newVictory,
  STATUS_LOST,
  STATUS_PLAYING,
  STATUS_WON,
  VICTORY_SCORE,
  VICTORY_SPECIAL,
  VICTORY_STANDARD,
} from './victory';
import { COMMAND_DELAY_TURNS, STEP_MS, World, type StartUnit } from './world';

const DT = mul32(STEP_MS, MS_TO_SECONDS);
const ofType = (w: World, type: number) => [...w.entities.all()].filter((e) => e.type === type);
const tile = (e: Entity) => [Math.trunc(e.x), Math.trunc(e.y)];

/** Gaia and two players with these objects (ids from 1 in list order); conquest off. */
function world(...units: StartUnit[]): World {
  return new World({ players: 3, units, victory: { type: VICTORY_SPECIAL } });
}

function move(w: World, player: number, id: number, x: number, y: number): void {
  w.addBatch(w.turn, player, [{ type: 'move', units: [id], x, y }]);
  for (let i = 0; i <= COMMAND_DELAY_TURNS; i++) w.runTurn();
}

function runUntil(w: World, done: () => boolean, limit = 200): void {
  for (let i = 0; i < limit && !done(); i++) w.runTurn();
  expect(done()).toBe(true);
}

describe('victory.md §3: relics and ruins on a random map (src/tworld.cpp:727-737)', () => {
  // Seeds 1..6 over three map types and sizes: 5 relics (159) and/or 5 ruins (158), Gaia's, as the two rolls say.
  const cases: [string, number, number, [number, number][]][] = [
    ['Mostly Land, Large', MAP_MOSTLY_LAND, 144, [[5, 0], [0, 0], [0, 0], [0, 0], [0, 0], [5, 5]]],
    ['Hill Country, Small', MAP_HILLY, MAP_SMALL, [[5, 0], [0, 5], [5, 5], [0, 5], [5, 0], [5, 5]]],
    ['Lake, Tiny', MAP_LAKE, MAP_TINY, [[5, 5], [0, 0], [5, 5], [0, 0], [0, 5], [5, 0]]],
  ];
  for (const [name, type, size, expected] of cases) {
    test(`${name}: relics and ruins per seed 1-6 are ${JSON.stringify(expected)}, each W/5 tiles apart`, () => {
      const got = expected.map((_, i) => {
        const w = new World({ players: 3, randomSeed: i + 1, randomMap: { type, size } });
        const relics = ofType(w, RELIC);
        const ruins = ofType(w, RUIN);
        expect([w.victory.artifactCount, w.victory.ruinCount]).toEqual([relics.length, ruins.length]);
        for (const group of [relics, ruins]) {
          expect(group.every((e) => e.owner === 0)).toBe(true);
          for (const a of group) {
            for (const b of group) {
              if (a === b) continue;
              const [ax, ay] = tile(a);
              const [bx, by] = tile(b);
              expect(Math.max(Math.abs(ax! - bx!), Math.abs(ay! - by!))).toBeGreaterThanOrEqual(Math.trunc(size / 5));
            }
          }
        }
        return [relics.length, ruins.length];
      });
      expect(got).toEqual(expected);
    });
  }

  test('a Score game always places the relics, without the relic roll (Lake, Tiny)', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const w = new World({ players: 3, randomSeed: seed, randomMap: { type: MAP_LAKE, size: MAP_TINY }, victory: { type: VICTORY_SCORE, amount: 3000 } });
      expect(ofType(w, RELIC)).toHaveLength(5);
      expect(w.victory.artifactCount).toBe(5);
    }
  });
});

describe('capture: TribeArtifactUnitAIModule (src/taiuaimd.cpp:2128-2162) and change_ownership (src/t_c_obj.cpp:240-251)', () => {
  test("a Gaia relic becomes the only nearby player's, with its storage (attribute 7) and player sprite", () => {
    const w = world({ owner: 0, type: RELIC, x: 30.5, y: 12.5 }, { owner: 1, type: VILLAGER, x: 32.5, y: 12.5 }, { owner: 2, type: VILLAGER, x: 47.5, y: 12.5 });
    const relic = w.entities.get(1)!;
    expect([relic.owner, w.attributes[0]![ATTR_ARTIFACTS], relic.sprite!.graphic]).toEqual([0, 1, typeOf(w, relic).standing.graphic]);
    const gaiaGraphic = relic.sprite!.graphic;
    runUntil(w, () => relic.owner === 1, 20);
    expect([w.attributes[0]![ATTR_ARTIFACTS], w.attributes[1]![ATTR_ARTIFACTS], w.attributes[2]![ATTR_ARTIFACTS]]).toEqual([0, 1, 0]);
    expect(relic.sprite!.graphic).not.toBe(gaiaGraphic);
    expect(relic.sprite!.graphic).toBe(typeOf(w, relic).standing.graphic);
    expect(relic.hp).toBe(1);
  });

  test('recapture: with two players in view the holder keeps it; once the holder leaves, the other takes it', () => {
    const w = world({ owner: 0, type: RELIC, x: 30.5, y: 12.5 }, { owner: 1, type: VILLAGER, x: 32.5, y: 12.5 }, { owner: 2, type: VILLAGER, x: 47.5, y: 12.5 });
    const relic = w.entities.get(1)!;
    runUntil(w, () => relic.owner === 1, 20);
    move(w, 2, 3, 31.5, 13.5);
    for (let i = 0; i < 60; i++) w.runTurn();
    const [x, y] = tile(w.entities.get(3)!);
    expect(Math.max(Math.abs(x! - 30), Math.abs(y! - 12))).toBeLessThanOrEqual(2);
    expect(relic.owner).toBe(1);
    move(w, 1, 2, 5.5, 5.5);
    runUntil(w, () => relic.owner === 2);
    expect([w.attributes[1]![ATTR_ARTIFACTS], w.attributes[2]![ATTR_ARTIFACTS]]).toEqual([0, 1]);
  });

  test('a Gaia relic with two players next to it stays Gaia\'s', () => {
    const w = world({ owner: 0, type: RELIC, x: 30.5, y: 12.5 }, { owner: 1, type: VILLAGER, x: 31.5, y: 12.5 }, { owner: 2, type: VILLAGER, x: 29.5, y: 12.5 });
    for (let i = 0; i < 60; i++) w.runTurn();
    expect(w.entities.get(1)!.owner).toBe(0);
  });

  test('Gaia never takes it back: the holder walks away and keeps it', () => {
    const w = world({ owner: 0, type: RELIC, x: 30.5, y: 12.5 }, { owner: 1, type: VILLAGER, x: 32.5, y: 12.5 }, { owner: 2, type: VILLAGER, x: 47.5, y: 12.5 });
    const relic = w.entities.get(1)!;
    runUntil(w, () => relic.owner === 1, 20);
    move(w, 1, 2, 5.5, 5.5);
    for (let i = 0; i < 80; i++) w.runTurn();
    expect(w.entities.get(2)!.x).toBeLessThan(10);
    expect([relic.owner, w.attributes[1]![ATTR_ARTIFACTS]]).toEqual([1, 1]);
  });

  test('a ruin (158, LOS 4) is taken the same way, feeding attribute 14; a Town Center (a building) does not take it', () => {
    const w = world({ owner: 0, type: RUIN, x: 30.5, y: 20.5 }, { owner: 1, type: TOWN_CENTER, x: 33.5, y: 20.5 }, { owner: 2, type: VILLAGER, x: 60.5, y: 5.5 });
    const ruin = w.entities.get(1)!;
    for (let i = 0; i < 40; i++) w.runTurn();
    expect(ruin.owner).toBe(0);
    move(w, 2, 3, 27.5, 20.5);
    runUntil(w, () => ruin.owner === 2);
    expect([w.attributes[0]![ATTR_RUINS], w.attributes[1]![ATTR_RUINS], w.attributes[2]![ATTR_RUINS]]).toEqual([0, 0, 1]);
  });
});

describe('victory.md §10 / Example 2: all relics and all ruins held (src/tworld.cpp:965-1075)', () => {
  const held = (artifacts: [number, number], ruins: [number, number] = [0, 0]) => {
    const a = [[], [], []] as number[][];
    a[1]![ATTR_ARTIFACTS] = artifacts[0];
    a[2]![ATTR_ARTIFACTS] = artifacts[1];
    a[1]![ATTR_RUINS] = ruins[0];
    a[2]![ATTR_RUINS] = ruins[1];
    return a;
  };

  test('Standard: armed at 2000 the step all 5 are held, won 11105 steps later at 0.8451457619667053 (code 101)', () => {
    const v = newVictory(3, { type: VICTORY_STANDARD });
    v.artifactCount = 5;
    const a = held([5, 0]);
    checkGameState(v, DT, a);
    expect([v.artifactHeld[1], a[1]![ATTR_ALL_ARTIFACTS]]).toEqual([2000, 1]);
    let steps = 0;
    while (v.gameState === 0) {
      checkGameState(v, DT, a);
      steps++;
    }
    expect(steps).toBe(11105);
    expect(v.artifactHeld[1]).toBe(0.8451457619667053);
    expect([v.status, v.endCondition]).toEqual([[0, STATUS_WON, STATUS_LOST], END_ALL_RELICS]);
  });

  test('losing one resets the countdown and attribute 55; 4 + 1 across players never arms it', () => {
    const v = newVictory(3, { type: VICTORY_STANDARD });
    v.artifactCount = 5;
    const a = held([5, 0]);
    for (let i = 0; i < 100; i++) checkGameState(v, DT, a);
    expect(v.artifactHeld[1]).toBeLessThan(2000);
    a[1]![ATTR_ARTIFACTS] = 4;
    a[2]![ATTR_ARTIFACTS] = 1;
    checkGameState(v, DT, a);
    expect([v.artifactHeld[1], v.artifactHeld[2], a[1]![ATTR_ALL_ARTIFACTS]]).toEqual([-1, -1, 0]);
    for (let i = 0; i < 100; i++) checkGameState(v, DT, a);
    expect([v.artifactHeld, v.gameState]).toEqual([[-1, -1, -1], 0]);
  });

  test('ruins run the same countdown, code 102', () => {
    const v = newVictory(3, { type: VICTORY_STANDARD });
    v.ruinCount = 5;
    const a = held([0, 0], [0, 5]);
    let steps = 0;
    while (v.gameState === 0) {
      checkGameState(v, DT, a);
      steps++;
    }
    expect(steps).toBe(11106);
    expect([v.status, v.endCondition, a[2]![ATTR_ALL_RUINS]]).toEqual([[0, STATUS_LOST, STATUS_WON], END_ALL_RUINS, 1]);
  });

  test('outside Standard: attribute 55 is set (50 score points) but nothing counts down and the game goes on', () => {
    const v = newVictory(3, { type: VICTORY_SCORE, amount: 3000 });
    v.artifactCount = 5;
    const a = held([5, 0]);
    for (let i = 0; i < 12000; i++) checkGameState(v, DT, a);
    expect([v.artifactHeld[1], a[1]![ATTR_ALL_ARTIFACTS], v.gameState, v.status[1]]).toEqual([-1, 1, 0, STATUS_PLAYING]);
    // The quirk: losing them never clears 55, since the held time is still -1.
    a[1]![ATTR_ARTIFACTS] = 4;
    checkGameState(v, DT, a);
    expect(a[1]![ATTR_ALL_ARTIFACTS]).toBe(1);
  });

  test('a seeded Standard game (Mostly Land, Large, seed 1): player 1 takes the 5 relics and wins 11105 steps later', () => {
    const w = new World({ players: 3, randomSeed: 1, randomMap: {} });
    expect(w.victory.artifactCount).toBe(5);
    // Bring the map's relics next to player 1's Villagers, one tile apart.
    const [vx, vy] = tile(ofType(w, VILLAGER).find((e) => e.owner === 1)!);
    ofType(w, RELIC).forEach((r, i) => teleport(w.gameContext(), r, typeOf(w, r), vx! + 0.5 + (i % 3) - 1, vy! + 1.5 + Math.trunc(i / 3), 0));
    let steps = 0;
    while (w.attributes[1]![ATTR_ARTIFACTS] !== 5 && steps < 2000) {
      w.runStep();
      steps++;
    }
    expect(ofType(w, RELIC).map((r) => r.owner)).toEqual([1, 1, 1, 1, 1]);
    expect([w.victory.artifactHeld[1], w.attributes[1]![ATTR_ALL_ARTIFACTS]]).toEqual([2000, 1]);
    let countdown = 0;
    while (!w.gameOver && countdown < 12000) {
      w.runStep();
      countdown++;
    }
    expect(countdown).toBe(11105);
    expect(w.gameResult()).toEqual({ endCondition: END_ALL_RELICS, winners: [1], status: [0, STATUS_WON, STATUS_LOST] });
  });
});
