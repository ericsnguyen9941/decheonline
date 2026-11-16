import { describe, expect, test } from 'vitest';
import { checkDamageSprites } from './damage';
import { ObjectState, type Entity } from './entities';
import { newMasters, typeOf } from './masters';
import { f32 } from './num';
import { CrtRand } from './rng';
import { makeActiveSprite } from './sprites';
import { HOUSE, SMALL_WALL, TOWN_CENTER, VILLAGER } from './units';
import { World } from './world';

/** A rand() that counts its draws. */
class CountingRand extends CrtRand {
  draws = 0;
  override rand(): number {
    this.draws++;
    return super.rand();
  }
}

function setup(type: number) {
  const rng = new CountingRand();
  const ctx = { rng, masters: [newMasters(1), newMasters(1)] };
  const t = typeOf(ctx, { owner: 1, type });
  const e = { id: 1, owner: 1, type, x: 10.5, y: 10.5, z: 0, hp: f32(t.hitPoints), state: ObjectState.Active, heldType: -1, heldAmount: 0, stamped: true, sprite: makeActiveSprite(t.standing, rng) } as Entity;
  rng.draws = 0;
  const at = (fraction: number) => {
    e.hp = f32(t.hitPoints * fraction);
    checkDamageSprites(ctx, e, t);
    return (e.overlays ?? []).map((o) => o.graphic);
  };
  return { ctx, rng, t, e, at };
}

describe('damage sprites (check_damage_sprites, sprites.md §6)', () => {
  test('the dat gives the House flames 805/806/807 past 25/50/75% damage and the Town Center 131/132/133, flag 1', () => {
    const house = setup(HOUSE).t.damageSprites.map((d) => [d.sprite?.graphic, d.percent, d.flag]);
    expect(house).toEqual([
      [805, 25, 1],
      [806, 50, 1],
      [807, 75, 1],
    ]);
    expect(setup(TOWN_CENTER).t.damageSprites.map((d) => [d.sprite?.graphic, d.percent])).toEqual([
      [131, 25],
      [132, 50],
      [133, 75],
    ]);
    expect(setup(SMALL_WALL).t.damageSprites.map((d) => [d.sprite?.graphic, d.percent, d.flag])).toEqual([[700, 50, 2]]);
    expect(setup(VILLAGER).t.damageSprites).toEqual([]);
  });

  test('each band past its percent shows one flame, replacing the last; a repair takes it away', () => {
    const { e, at } = setup(HOUSE);
    expect(at(0.8)).toEqual([]);
    expect(e.damagePercent).toBe(20);
    // 25% damage is not past 25.
    expect(at(0.75)).toEqual([]);
    expect(at(0.74)).toEqual([805]);
    expect(e.damagePercent).toBe(26);
    expect(at(0.5)).toEqual([805]);
    expect(at(0.49)).toEqual([806]);
    expect(at(0.2)).toEqual([807]);
    expect(at(0.6)).toEqual([805]);
    expect(at(1)).toEqual([]);
    expect(e.damagePercent).toBe(0);
  });

  test('a flag-1 flame draws rand() twice for its point and once for its random start frame; a removal draws none', () => {
    const { rng, e, at } = setup(HOUSE);
    at(0.7);
    expect(rng.draws).toBe(3);
    expect(e.overlays![0]!.frame).toBeGreaterThanOrEqual(0);
    expect(e.overlays![0]!.frame).toBeLessThan(20);
    at(0.69);
    expect(rng.draws).toBe(3);
    at(1);
    expect(rng.draws).toBe(3);
  });

  test('at 100% damage nothing changes: a dying building keeps its flame', () => {
    const { t, e, at } = setup(HOUSE);
    at(0.1);
    expect(at(0.5 / t.hitPoints)).toEqual([807]);
    expect(e.damagePercent).toBe(100);
  });

  test('a flag-2 entry is the wall sprite past 50% damage, and the standing sprite again below it', () => {
    const { t, e, at } = setup(SMALL_WALL);
    at(0.4);
    expect(e.sprite!.graphic).toBe(700);
    expect(e.overlays).toBeUndefined();
    at(0.9);
    expect(e.sprite!.graphic).toBe(t.standing.graphic);
  });

  test('in a world, a House hit past 75% damage carries flame 807 in its state, hashed and in the snapshot', () => {
    const world = new World({ players: 3, revealMap: true, units: [{ owner: 1, type: HOUSE, x: 10, y: 10 }, { owner: 2, type: VILLAGER, x: 40.5, y: 40.5 }] });
    const house = [...world.entities.all()].find((e) => e.type === HOUSE)!;
    const before = world.hash();
    house.hp = f32(house.hp * 0.2);
    world.runStep();
    expect(house.overlays?.map((o) => o.graphic)).toEqual([807]);
    expect(world.hash()).not.toBe(before);
    const restored = World.restore(JSON.parse(JSON.stringify(world.snapshot())));
    expect(restored.entities.get(house.id)!.overlays).toEqual(house.overlays);
    expect(restored.hash()).toBe(world.hash());
  });
});
