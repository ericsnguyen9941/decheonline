import { describe, expect, test } from 'vitest';
import { build, checkPlacement } from './buildings';
import { ATTACK_FAILED } from './combat';
import type { Command } from './commands';
import { ObjectState } from './entities';
import { master, typeOf } from './masters';
import { teleport } from './movement';
import { doEffect } from './techs';
import { bestUnitToAttack, VISIBLE_DISTANCE } from './unit-ai';
import { BARRACKS, CLUBMAN, TOWN_CENTER, VILLAGER, WATCH_TOWER } from './units';
import { losDistanceTable, losShape, TILE_BLACK, TILE_FOGGED, TILE_VISIBLE } from './visibility';
import { VICTORY_SPECIAL } from './victory';
import { World, type StartUnit } from './world';

/** Conquest off: these worlds often leave a player with nothing, which would end the game. */
function world(...units: StartUnit[]): World {
  return new World({ players: 3, units, victory: { type: VICTORY_SPECIAL } });
}

function order(w: World, player: number, command: Command): void {
  w.addBatch(w.turn, player, [command]);
  for (let i = 0; i < 3; i++) w.runTurn();
}

function runUntil(w: World, done: () => boolean, limit: number): void {
  for (let i = 0; i < limit && !done(); i++) w.runTurn();
  expect(done()).toBe(true);
}

/** Viewer-count byte of `player` at (col, row). */
function count(w: World, player: number, col: number, row: number): number {
  return w.visibility.counts[player]![row * w.visibility.width + col]!;
}

describe('visibility.md §2 V1: line-of-sight shapes', () => {
  test('radius 4 is rows |dy| 0, 1 → ±4; 2, 3 → ±3; 4 → ±1; square radius 2 is the 4×4 block -2..1', () => {
    expect(losShape(4, false).map((r) => [r.dy, r.dx1, r.dx2])).toEqual([
      [-4, -1, 1],
      [-3, -3, 3],
      [-2, -3, 3],
      [-1, -4, 4],
      [0, -4, 4],
      [1, -4, 4],
      [2, -3, 3],
      [3, -3, 3],
      [4, -1, 1],
    ]);
    expect(losShape(2, true).map((r) => [r.dy, r.dx1, r.dx2])).toEqual([
      [-2, -2, 1],
      [-1, -2, 1],
      [0, -2, 1],
      [1, -2, 1],
    ]);
    const tiles = (r: number) => losShape(r, false).reduce((n, row) => n + row.dx2 - row.dx1 + 1, 0);
    expect([4, 5, 8, 10].map(tiles)).toEqual([61, 97, 221, 349]);
  });

  test('the unit-AI distance table (unit-ai.md §3.2) is the smallest radius whose shape holds the cell', () => {
    expect(losDistanceTable()).toEqual(VISIBLE_DISTANCE);
  });
});

describe('visibility.md §7: vectors', () => {
  test('V2 a Villager (LOS 4) at (10.5, 10.5) explores the 61 tiles of the radius-4 shape for its player only', () => {
    const w = world({ owner: 1, type: VILLAGER, x: 10.5, y: 10.5 });
    expect(w.visibility.explored).toEqual([0, 61, 0]);
    expect([w.tileVisibility(1, 14, 10), w.tileVisibility(1, 15, 10), w.tileVisibility(1, 13, 13), w.tileVisibility(1, 14, 13)]).toEqual([
      TILE_VISIBLE,
      TILE_BLACK,
      TILE_VISIBLE,
      TILE_BLACK,
    ]);
    expect(w.tileVisibility(2, 10, 10)).toBe(TILE_BLACK);
    expect(count(w, 1, 10, 10)).toBe(1);
    expect(w.visibility.cell(10, 10)).toBe((1 << 1) | (1 << 17));
  });

  test('V3 one tile east: the column left behind is fogged (byte 0), 9 new tiles are explored', () => {
    const w = world({ owner: 1, type: VILLAGER, x: 10.5, y: 10.5 });
    const v = w.entities.get(1)!;
    teleport(w.gameContext(), v, typeOf(w, v), 11.5, 10.5, 0);
    expect(w.visibility.explored[1]).toBe(70);
    expect([w.tileVisibility(1, 6, 10), count(w, 1, 6, 10), w.tileVisibility(1, 15, 10)]).toEqual([TILE_FOGGED, 0, TILE_VISIBLE]);
    // Moving within a tile changes nothing.
    teleport(w.gameContext(), v, typeOf(w, v), 11.9, 10.2, 0);
    expect([w.visibility.explored[1], count(w, 1, 11, 10)]).toEqual([70, 1]);
  });

  test('V4 two Villagers on one tile count 2 there; when one walks off the tile stays seen', () => {
    const w = world({ owner: 1, type: VILLAGER, x: 10.5, y: 10.5 }, { owner: 1, type: VILLAGER, x: 10.5, y: 10.5 });
    expect(count(w, 1, 10, 10)).toBe(2);
    const v = w.entities.get(2)!;
    teleport(w.gameContext(), v, typeOf(w, v), 20.5, 10.5, 0);
    expect([count(w, 1, 10, 10), w.tileVisibility(1, 10, 10), count(w, 1, 6, 10)]).toEqual([1, TILE_VISIBLE, 1]);
  });

  test('V5 a Barracks foundation sees its 3×3 footprint; finishing it trades that for its radius-5 shape (97 tiles)', () => {
    const w = world();
    const b = w.createObject(1, BARRACKS, 20.5, 20.5, 0);
    expect(w.visibility.explored[1]).toBe(9);
    expect([w.tileVisibility(1, 19, 19), w.tileVisibility(1, 21, 21), w.tileVisibility(1, 22, 20)]).toEqual([TILE_VISIBLE, TILE_VISIBLE, TILE_BLACK]);
    build(w.gameContext(), b, 10000);
    expect(b.state).toBe(ObjectState.Active);
    expect([w.visibility.explored[1], count(w, 1, 20, 20), w.tileVisibility(1, 25, 20)]).toEqual([97, 1, TILE_VISIBLE]);
  });

  test('V6 a dying Villager sees only its own tile; once removed its player is blind there', () => {
    const w = world({ owner: 1, type: VILLAGER, x: 10.5, y: 10.5 });
    const v = w.entities.get(1)!;
    v.hp = 0;
    runUntil(w, () => v.state >= ObjectState.Dying, 5);
    expect([count(w, 1, 10, 10), count(w, 1, 11, 10), w.visibility.explored[1]]).toEqual([1, 0, 61]);
    runUntil(w, () => !w.entities.get(1), 100);
    expect([count(w, 1, 10, 10), w.tileVisibility(1, 10, 10)]).toEqual([0, TILE_FOGGED]);
  });

  test('V7 a foundation needs one explored tile under it (placement reason 5)', () => {
    const w = world();
    const ctx = w.gameContext();
    const t = master(w, 1, BARRACKS);
    expect(checkPlacement(ctx, t, 30.5, 30.5, true, true, 1)).toBe(5);
    expect(checkPlacement(ctx, t, 30.5, 30.5, true, true)).toBe(0);
    w.visibility.explore(1, 29, 29, 0, false);
    expect(checkPlacement(ctx, t, 30.5, 30.5, true, true, 1)).toBe(0);
    expect(checkPlacement(ctx, t, 30.5, 30.5, true, true, 2)).toBe(5);
    order(w, 2, { type: 'build', units: [], unitType: BARRACKS, x: 30.5, y: 30.5 });
    expect(w.entities.size).toBe(0);
  });

  test('V8 a unit only auto-targets enemies its player can see', () => {
    const units: StartUnit[] = [
      { owner: 1, type: CLUBMAN, x: 10.5, y: 10.5 },
      { owner: 2, type: VILLAGER, x: 13.5, y: 10.5 },
    ];
    const seen = world(...units);
    runUntil(seen, () => seen.entities.get(1)!.attack?.target === 2, 60);
    expect(seen.visibility.recordsOf(1, 4).map((r) => r.id)).toEqual([2]);

    // The same, with player 1's sight of the tiles around the Villager taken away before anything updates.
    const hidden = world(...units);
    hidden.visibility.unexplore(1, 13, 10, 1, false);
    expect(hidden.tileVisibility(1, 13, 10)).toBe(TILE_FOGGED);
    for (let i = 0; i < 60; i++) hidden.runTurn();
    expect(hidden.visibility.recordsOf(1, 4)).toEqual([]);
    expect(hidden.entities.get(1)!.attack ?? null).toBe(null);
    expect(hidden.entities.get(2)!.hp).toBe(25);
  });

  test('V9 a record keeps the tile where its player first saw the object (stale position)', () => {
    // A Town Center (LOS 7) sees the Villager at (14, 10); it then walks to (17, 10), next to the Clubman, still in view.
    const units: StartUnit[] = [
      { owner: 1, type: TOWN_CENTER, x: 10.5, y: 10.5 },
      { owner: 1, type: CLUBMAN, x: 21.5, y: 10.5 },
      { owner: 2, type: VILLAGER, x: 14.5, y: 10.5 },
    ];
    const w = world(...units);
    w.runTurn();
    const villager = w.entities.get(3)!;
    teleport(w.gameContext(), villager, typeOf(w, villager), 17.5, 10.5, 0);
    w.runTurn();
    expect(w.tileVisibility(1, 17, 10)).toBe(TILE_VISIBLE);
    expect(w.visibility.recordsOf(1, 4).map((r) => [r.id, r.x, r.y])).toEqual([[3, 14, 10]]);
    expect(bestUnitToAttack(w.gameContext(), w.entities.get(2)!, true, false)).toBe(-1);

    // First seen at (17, 10), it is the Clubman's target.
    const fresh = world(units[0]!, units[1]!, { ...units[2]!, x: 17.5 });
    fresh.runTurn();
    expect(bestUnitToAttack(fresh.gameContext(), fresh.entities.get(2)!, true, false)).toBe(3);
  });

  test('V10 an ordered attack on an enemy on a fogged tile fails (state 13) when its fog_flag is 0', () => {
    const w = world({ owner: 1, type: CLUBMAN, x: 10.5, y: 10.5 }, { owner: 2, type: VILLAGER, x: 11.5, y: 10.5 });
    w.visibility.unexplore(1, 11, 10, 1, false);
    expect(w.tileVisibility(1, 11, 10)).toBe(TILE_FOGGED);
    order(w, 1, { type: 'attack', units: [1], target: 2 });
    runUntil(w, () => w.entities.get(1)!.attack?.state === ATTACK_FAILED, 20);
    expect(w.entities.get(2)!.hp).toBe(25);
  });

  test('V11 LOS effects re-explore: +2 on a Watch Tower (effect 91) and its copy to a Guard Tower (effect 15) see 349 tiles', () => {
    for (const effect of [91, 15]) {
      const w = world({ owner: 1, type: WATCH_TOWER, x: 20.5, y: 20.5 });
      expect([w.visibility.explored[1], w.tileVisibility(1, 30, 20)]).toEqual([221, TILE_BLACK]);
      doEffect(w.gameContext(), 1, effect);
      expect([w.visibility.explored[1], w.tileVisibility(1, 30, 20), count(w, 1, 20, 20), count(w, 1, 28, 20)]).toEqual([349, TILE_VISIBLE, 1, 1]);
    }
  });

  test('V12 fog_update is drawn per player at creation (3, 4, 3) before the setup seed', () => {
    expect(new World({ players: 3 }).fogUpdate).toEqual([3, 4, 3]);
  });

  test('the hash covers the fog: one more viewer changes it, and a snapshot restores it', () => {
    const w = world({ owner: 1, type: VILLAGER, x: 10.5, y: 10.5 });
    w.runTurn();
    const before = w.hash();
    const restored = World.restore(JSON.parse(JSON.stringify(w.snapshot())) as ReturnType<World['snapshot']>);
    expect(restored.hash()).toBe(before);
    expect(restored.visibility.recordsOf(1, 4)).toEqual(w.visibility.recordsOf(1, 4));
    w.visibility.explore(2, 30, 30, 1, false);
    expect(w.hash()).not.toBe(before);
  });
});
