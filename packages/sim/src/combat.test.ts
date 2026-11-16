import { describe, expect, test } from 'vitest';
import { ATTACK_ATTACKING, ATTACK_MOVING, ATTACK_WAITING, attackWork, doAttack, launch, setAttackState, startAttack, updateMissile } from './combat';
import type { Command } from './commands';
import type { GameContext } from './context';
import { ObjectState, type Entity } from './entities';
import { facetOf, currentSprite } from './movement';
import { f32, mul32, MS_TO_SECONDS, sub32 } from './num';
import { TileMap } from './map';
import { updateObject } from './objects';
import { CrtRand } from './rng';
import { VICTORY_SPECIAL } from './victory';
import {
  AI_ACTION_ATTACK,
  AI_ORDER_ATTACK,
  bestUnitToAttack,
  createUnitAI,
  notifyObject,
  NOTIFY_ATTACKED,
  updateUnitAI,
} from './unit-ai';
import { BARRACKS, BOWMAN, CLUBMAN, FLARE, GAZELLE, HOUSE, unitType, VILLAGER } from './units';
import { refreshSighting } from './visibility';
import { World, type StartUnit } from './world';
import { typeOf } from './masters';

const ATTR_KILLS = 20;
const ATTR_RAZINGS = 43;
const DEAD_MAN = 43;

function order(world: World, player: number, command: Command): void {
  world.addBatch(world.turn, player, [command]);
}

/** Run turns until `done` holds; fails after `limit` turns. */
function runUntil(world: World, done: () => boolean, limit = 400): void {
  for (let i = 0; i < limit && !done(); i++) world.runTurn();
  expect(done()).toBe(true);
}

/** A world of Gaia and two players with these units; ids follow the list order from 1. Conquest off, so a side that
 * loses its last unit does not end the game. */
function world(...units: StartUnit[]): World {
  return new World({ players: 3, units, victory: { type: VICTORY_SPECIAL } });
}

/** Each combat object's first update records what its player sees (visibility.md §4.1), as before any unit AI runs. */
function seeAll(w: World): void {
  for (const e of w.entities.all()) if (typeOf(w, e).masterType >= 50) refreshSighting(w, e, typeOf(w, e));
}

/** The context the combat.md vectors step with: 50 ms steps. */
function stepContext(w: World): GameContext {
  const ctx = w.gameContext();
  ctx.deltaSeconds = mul32(50, MS_TO_SECONDS);
  expect(ctx.deltaSeconds).toBe(0.05000000074505806);
  return ctx;
}

/** Face east (angle 0). */
function faceEast(e: Entity): void {
  e.mover!.angle = 0;
  e.mover!.facet = facetOf(0, currentSprite(e, unitType(e.type)));
}

/** Damage per hit and hp left, every time the target's hp changes, until `limit` turns pass or it dies. */
function hits(w: World, target: Entity, limit: number): number[] {
  const seen: number[] = [];
  let hp = target.hp;
  for (let i = 0; i < limit && target.hp >= 1; i++) {
    w.runTurn();
    if (target.hp !== hp) {
      seen.push(sub32(hp, target.hp));
      hp = target.hp;
    }
  }
  return seen;
}

describe('combat.md §8 Example 1: damage from the dat weapons and armours', () => {
  const cases: [string, number, number, boolean, number][] = [
    // attacker, target, attacker higher, hp after one hit at full hp
    ['Villager -> Clubman: (4,3) vs 0 -> 3; (10,-150) dropped', VILLAGER, CLUBMAN, false, 37],
    ['Bowman -> Clubman, level ground: (3,3) vs armour (3,0) -> 3', BOWMAN, CLUBMAN, false, 37],
    ['Bowman -> Clubman, Bowman higher: 3 x 1.5', BOWMAN, CLUBMAN, true, 35.5],
    ['Clubman -> Villager: (4,3) vs base armour 0 -> 3', CLUBMAN, VILLAGER, false, 22],
    ['Bowman -> Villager: (3,3) -> 3', BOWMAN, VILLAGER, false, 22],
    ['Clubman -> Barracks: (4,3) vs (4,0) -> 3', CLUBMAN, BARRACKS, false, 347],
  ];
  for (const [name, attacker, target, higher, after] of cases) {
    test(`${name}: ${unitType(target).hitPoints} -> ${after}`, () => {
      const w = world({ owner: 1, type: attacker, x: 10.5, y: 10.5 }, { owner: 2, type: target, x: 15.5, y: 15.5 });
      const a = w.entities.get(1)!;
      const t = w.entities.get(2)!;
      if (higher) a.z = 1;
      const ctx = stepContext(w);
      ctx.rng.srand(14);
      doAttack(ctx, a, t, a.x, a.y);
      expect(t.hp).toBe(after);
    });
  }

  test('a hit always costs at least 1 hp: a unit at 1.5 hp hit for 0.5 by a lower melee unit is left at 0.5', () => {
    const w = world({ owner: 1, type: VILLAGER, x: 10.5, y: 10.5 }, { owner: 2, type: CLUBMAN, x: 11.5, y: 10.5 });
    const t = w.entities.get(2)!;
    const a = w.entities.get(1)!;
    t.hp = f32(1.5);
    t.z = 1;
    doAttack(stepContext(w), a, t, a.x, a.y);
    // 3 x 0.6666 = 1.9998 takes it below 1 (clamped to 0): no minimum; the kill counts.
    expect([t.hp, w.attributes[1]![ATTR_KILLS]]).toEqual([0, 1]);
  });
});

describe('combat.md §2.3: the hill modifier from world_z (calc_attack_modifier, src/t_c_obj.cpp:288)', () => {
  /** A 48 x 48 grass map with a one-level plateau over tiles 8-12 (both ways): (10.5, 10.5) is on it. */
  function hill(...units: StartUnit[]): World {
    const map = new TileMap(48, 48);
    for (let row = 8; row <= 12; row++) for (let col = 8; col <= 12; col++) map.setTile(col, row, 0, 1);
    return new World({ players: 3, map, units, victory: { type: VICTORY_SPECIAL } });
  }

  const ON = 10.5;
  const BELOW = 15.5;
  const cases: [string, number, number, number, number, number, number, number][] = [
    // name, attacker type, its x/y, target type, its x/y, the attacker's and target's z, hp after one hit
    ['ranged attacker higher: Bowman on the hill -> Clubman below, 3 x 1.5', BOWMAN, ON, CLUBMAN, BELOW, 1, 0, 35.5],
    ['ranged attacker lower: Bowman below -> Clubman on the hill, no penalty', BOWMAN, BELOW, CLUBMAN, ON, 0, 1, 37],
    ['ranged, same height: both on the hill', BOWMAN, ON, CLUBMAN, 12.5, 1, 1, 37],
    ['melee attacker lower: Clubman below -> Villager on the hill, 3 x 0.6666', CLUBMAN, 13.5, VILLAGER, 12.5, 0, 1, sub32(25, mul32(3, f32(0.6666)))],
    ['melee attacker higher: Clubman on the hill -> Villager below, no bonus', CLUBMAN, 12.5, VILLAGER, 13.5, 1, 0, 22],
    ['melee, same height: both on the hill', CLUBMAN, ON, VILLAGER, 11.5, 1, 1, 22],
  ];
  for (const [name, attacker, ax, target, tx, az, tz, after] of cases) {
    test(`${name}: ${after}`, () => {
      const w = hill({ owner: 1, type: attacker, x: ax, y: ax }, { owner: 2, type: target, x: tx, y: tx });
      const a = w.entities.get(1)!;
      const t = w.entities.get(2)!;
      // Placement (teleport) set each z from the ground.
      expect([a.z, t.z]).toEqual([az, tz]);
      const ctx = stepContext(w);
      ctx.rng.srand(14);
      doAttack(ctx, a, t, a.x, a.y);
      expect(t.hp).toBe(after);
    });
  }

  // higher_than_target's cliff count (src/t_c_obj.cpp:803, :762): level ground, a cliff on the line to the target.
  for (const [facet, after] of [
    [6, 35.5],
    [0, 37],
  ] as const) {
    test(`ranged, level, a cliff of facet ${facet} on the line: ${after === 35.5 ? 'higher (angle 0 inside its window), 3 x 1.5' : 'not higher (angle 0 outside its window)'}`, () => {
      const w = world({ owner: 1, type: BOWMAN, x: 10.5, y: 10.5 }, { owner: 2, type: CLUBMAN, x: 15.5, y: 10.5 });
      const cliff = w.createObject(0, 264, 12.5, 10.5, 0);
      cliff.facet = facet;
      const a = w.entities.get(1)!;
      const t = w.entities.get(2)!;
      expect([a.z, t.z]).toEqual([0, 0]);
      const ctx = stepContext(w);
      ctx.rng.srand(14);
      doAttack(ctx, a, t, a.x, a.y);
      expect(t.hp).toBe(after);
    });
  }
});

describe('combat.md §8 Example 2: reload cadence', () => {
  for (const [type, steps] of [
    [CLUBMAN, 31],
    [BOWMAN, 29],
  ] as const) {
    test(`${unitType(type).name}: the reload timer reaches 0 after ${steps} float32 steps of 50 ms`, () => {
      const w = world({ owner: 1, type, x: 10.5, y: 10.5 });
      const e = w.entities.get(1)!;
      const ctx = stepContext(w);
      e.attackTimer = unitType(type).combat!.reloadTime;
      let n = 0;
      while (e.attackTimer > 0) {
        updateObject(ctx, e);
        n++;
      }
      expect(n).toBe(steps);
    });
  }
});

describe('combat.md §8 Example 3: in range or not', () => {
  for (const [distance, inRange] of [
    [6.3, true],
    [6.32, true],
    [6.33, false],
  ] as const) {
    test(`Bowman to Clubman centre distance ${distance}: ${inRange ? 'attacks' : 'moves (state 4)'}`, () => {
      const w = world({ owner: 1, type: BOWMAN, x: 10.5, y: 10.5 }, { owner: 2, type: CLUBMAN, x: f32(10.5 + distance), y: 10.5 });
      const bowman = w.entities.get(1)!;
      const clubman = w.entities.get(2)!;
      const ctx = stepContext(w);
      faceEast(bowman);
      const a = startAttack(ctx, bowman, clubman, null, null, 0, false);
      // Forget the remembered target point, or the "target has not moved" shortcut skips the range test.
      a.x = a.y = a.z = f32(-1);
      setAttackState(ctx, bowman, a, ATTACK_WAITING);
      expect(a.state).toBe(inRange ? ATTACK_ATTACKING : ATTACK_MOVING);
    });
  }
});

describe('combat.md §3.1: RGE_Action_Attack::work names a new target without latching its position', () => {
  test('a Bowman switched to another Clubman keeps the latched point and chases it (state 4)', () => {
    const w = world(
      { owner: 1, type: BOWMAN, x: 10.5, y: 10.5 },
      { owner: 2, type: CLUBMAN, x: 14.5, y: 10.5 },
      { owner: 2, type: CLUBMAN, x: 14.5, y: 14.5 },
    );
    const bowman = w.entities.get(1)!;
    const ctx = stepContext(w);
    const a = startAttack(ctx, bowman, w.entities.get(2)!, null, null, 0, false);
    a.x = f32(3);
    a.y = f32(4);
    a.z = f32(0);
    expect(attackWork(ctx, bowman, w.entities.get(3)!)).toBe(true);
    expect([a.target, a.state, a.x, a.y, a.z]).toEqual([3, ATTACK_MOVING, f32(3), f32(4), 0]);
  });
});

describe('combat.md §8 Example 4: arrow flight and hit step', () => {
  test('spawned at (11, 10.5, 1.5) after a flare for the target owner; hits on its 10th update: Clubman 40 -> 37', () => {
    const w = world({ owner: 1, type: BOWMAN, x: 10.5, y: 10.5 }, { owner: 2, type: CLUBMAN, x: 15.5, y: 10.5 });
    const bowman = w.entities.get(1)!;
    const clubman = w.entities.get(2)!;
    const ctx = stepContext(w);
    faceEast(bowman);
    launch(ctx, bowman, clubman);
    const [flare, arrow] = [w.entities.get(3)!, w.entities.get(4)!];
    expect([flare.type, flare.owner, flare.x, flare.y]).toEqual([FLARE, 2, 10.5, 10.5]);
    expect([arrow.type, arrow.owner, arrow.x, arrow.y, arrow.z]).toEqual([9, 1, 11, 10.5, 1.5]);
    expect(arrow.missile!.maxRange).toBe(f32(11.4242639542));
    expect(arrow.missile!.ballisticVelocity).toBe(f32(1.6000000238));
    const xs: number[] = [];
    for (let step = 1; step <= 10; step++) {
      updateMissile(ctx, arrow);
      xs.push(arrow.x);
      if (step < 10) expect(clubman.hp).toBe(40);
    }
    expect([xs[0], xs[4], xs[8], xs[9]].map((x) => Number(x!.toFixed(5)))).toEqual([11.39649, 12.98246, 14.56842, 14.96491]);
    expect(Number(arrow.z.toFixed(5))).toBe(1.06647);
    expect([clubman.hp, arrow.missile!.state, arrow.hp]).toEqual([37, 1, 0]);
  });
});

describe('combat.md §8 Example 7: a Clubman kills an enemy Villager', () => {
  test('attack command: 8 hits of 3, then a 9th clamped at 0, kill the 25 hp Villager; one kill; it dies into Dead_Man', () => {
    const w = world({ owner: 1, type: CLUBMAN, x: 10.5, y: 10.5 }, { owner: 2, type: VILLAGER, x: 13.5, y: 10.5 });
    const clubman = w.entities.get(1)!;
    const villager = w.entities.get(2)!;
    order(w, 1, { type: 'attack', units: [1], target: 2 });
    w.runTurn();
    w.runTurn();
    w.runTurn();
    expect([clubman.ai!.order, clubman.ai!.action, clubman.ai!.target]).toEqual([AI_ORDER_ATTACK, AI_ACTION_ATTACK, 2]);
    expect(hits(w, villager, 200)).toEqual([3, 3, 3, 3, 3, 3, 3, 3, 1]);
    expect([villager.hp, w.attributes[1]![ATTR_KILLS]]).toEqual([0, 1]);
    runUntil(w, () => villager.state >= ObjectState.Dying, 2);
    expect(villager.sprite!.graphic).toBe(unitType(VILLAGER).dying!.graphic);
    runUntil(w, () => !w.entities.get(2));
    const dead = [...w.entities.all()].find((e) => e.type === DEAD_MAN)!;
    expect([dead.owner, dead.x, dead.y]).toEqual([2, villager.x, villager.y]);
    // The attack ends once the target is gone; the Clubman stands again.
    runUntil(w, () => !clubman.attack && clubman.ai!.action === -1);
  });
});

describe('combat.md §8 Example 8: a Bowman shoots a Villager dead', () => {
  test('9 arrows of 3 (the last clamped at 0); every launch shows the target owner a flare first; the Villager flees', () => {
    const w = world({ owner: 1, type: BOWMAN, x: 10.5, y: 10.5 }, { owner: 2, type: VILLAGER, x: 14.5, y: 10.5 });
    const bowman = w.entities.get(1)!;
    const villager = w.entities.get(2)!;
    // Objects created, in order (an arrow can live and die within one turn).
    const created: number[] = [];
    const create = w.createObject.bind(w);
    w.createObject = (owner, type, x, y, z) => {
      created.push(type);
      return create(owner, type, x, y, z);
    };
    order(w, 1, { type: 'attack', units: [1], target: 2 });
    let hp = villager.hp;
    const damage: number[] = [];
    for (let i = 0; i < 400 && villager.hp >= 1; i++) {
      w.runTurn();
      if (villager.hp !== hp) {
        damage.push(sub32(hp, villager.hp));
        hp = villager.hp;
      }
    }
    expect(damage).toEqual([3, 3, 3, 3, 3, 3, 3, 3, 1]);
    expect(villager.hp).toBe(0);
    expect(created).toEqual(Array.from({ length: 9 }, () => [FLARE, 9]).flat());
    // Hit by a player's unit, the Villager runs away east (unit-ai.md §4.3); the Bowman follows to keep it in range.
    expect(villager.x).toBeGreaterThan(14.5);
    expect(bowman.x).toBeGreaterThan(10.5);
  });
});

describe('combat.md §8 Example 9: a building is damaged and destroyed', () => {
  test('a Clubman takes a House (75 hp) down 3 hp a hit; at 0 it dies, the razing counts and its rubble appears', () => {
    const w = world({ owner: 1, type: CLUBMAN, x: 10.5, y: 10.5 }, { owner: 2, type: HOUSE, x: 14, y: 10 });
    const house = w.entities.get(2)!;
    order(w, 1, { type: 'attack', units: [1], target: 2 });
    const seen = hits(w, house, 800);
    expect(seen.length).toBe(25);
    expect(seen.every((d) => d === 3)).toBe(true);
    expect([house.hp, w.attributes[1]![ATTR_RAZINGS], w.attributes[1]![ATTR_KILLS]]).toEqual([0, 1, 0]);
    runUntil(w, () => !w.entities.get(2));
    expect([...w.entities.all()].some((e) => e.type === unitType(HOUSE).deadUnitId)).toBe(true);
  });
});

describe('unit-ai.md §7 Example 1: creation draws of the idle timeout', () => {
  test('from the fence at state 312: Clubman 3307 then 1174; Villager 3307; Gazelle 4299', () => {
    const at = (type: number) => {
      const rng = new CrtRand();
      rng.srand(312);
      rng.srand(rng.rand()); // creation fence: 1057
      rng.rand(); // facing: 3490
      return createUnitAI({ rng }, unitType(type))!.adjustedIdleTimeout;
    };
    expect([at(CLUBMAN), at(VILLAGER), at(GAZELLE)]).toEqual([1174, 3307, 4299]);
  });

  test('an idle Clubman scans on the AI update after its timer passes the timeout and attacks an enemy in view', () => {
    const w = world({ owner: 1, type: CLUBMAN, x: 10.5, y: 10.5 }, { owner: 2, type: VILLAGER, x: 13.5, y: 10.5 });
    const clubman = w.entities.get(1)!;
    runUntil(w, () => clubman.ai!.target !== -1, 20);
    expect([clubman.ai!.action, clubman.ai!.target, clubman.ai!.order, clubman.attack!.target]).toEqual([AI_ACTION_ATTACK, 2, -1, 2]);
  });

  test('a Villager does not auto-attack', () => {
    const w = world({ owner: 1, type: VILLAGER, x: 10.5, y: 10.5 }, { owner: 2, type: VILLAGER, x: 12.5, y: 10.5 });
    for (let i = 0; i < 20; i++) w.runTurn();
    expect([w.entities.get(1)!.attack, w.entities.get(2)!.attack]).toEqual([undefined, undefined]);
  });
});

describe('unit-ai.md §7 Example 2(a): idle target choice', () => {
  test('two units in view: the nearest (a Bowman 1.9 away) wins over a Villager 2.5 away', () => {
    const w = world(
      { owner: 1, type: CLUBMAN, x: 10.5, y: 10.5 },
      { owner: 2, type: VILLAGER, x: 13.5, y: 10.5 },
      { owner: 2, type: BOWMAN, x: 10.5, y: 8 },
    );
    seeAll(w);
    expect(bestUnitToAttack(w.gameContext(), w.entities.get(1)!, true, false)).toBe(3);
  });

  test('an object aboard a transport is skipped (`inside_obj`, src/aiuaimod.cpp:1248, :1357): the Villager wins', () => {
    const w = world(
      { owner: 1, type: CLUBMAN, x: 10.5, y: 10.5 },
      { owner: 2, type: VILLAGER, x: 13.5, y: 10.5 },
      { owner: 2, type: BOWMAN, x: 10.5, y: 8 },
    );
    seeAll(w);
    w.entities.get(3)!.inside = 2;
    expect(bestUnitToAttack(w.gameContext(), w.entities.get(1)!, true, false)).toBe(2);
  });
});

describe('unit-ai.md §7 Example 3: idle Clubman hit by a Bowman', () => {
  test('three fences from state 312 (1057, 3490, 11435), the alert cooldown starts, and it attacks the Bowman', () => {
    // Step 7 reads "has a game action" as cached at step 2: the new attack's AI action is cleared in the same update.
    const w = world({ owner: 1, type: CLUBMAN, x: 10.5, y: 10.5 }, { owner: 2, type: BOWMAN, x: 14.5, y: 10.5 });
    const clubman = w.entities.get(1)!;
    const ctx = w.gameContext();
    clubman.hp = 37;
    notifyObject(ctx, clubman, 2, NOTIFY_ATTACKED, 2, 37);
    ctx.rng.srand(312);
    updateUnitAI(ctx, clubman, 270);
    const next = new CrtRand();
    next.srand(11435);
    expect(ctx.rng.rand()).toBe(next.rand());
    expect(ctx.alertCooldown[1]).toBe(20);
    expect([clubman.ai!.attackers, clubman.ai!.action, clubman.ai!.target, clubman.attack!.target]).toEqual([[2], -1, 2, 2]);
  });

  test('a second hit within 20 s costs one fence only', () => {
    const w = world({ owner: 1, type: CLUBMAN, x: 10.5, y: 10.5 }, { owner: 2, type: BOWMAN, x: 14.5, y: 10.5 });
    const clubman = w.entities.get(1)!;
    const ctx = w.gameContext();
    notifyObject(ctx, clubman, 2, NOTIFY_ATTACKED, 2, 37);
    updateUnitAI(ctx, clubman, 270);
    // The Bowman stays in the attackers list only while it targets the Clubman.
    w.entities.get(2)!.ai!.target = 1;
    notifyObject(ctx, clubman, 2, NOTIFY_ATTACKED, 2, 34);
    ctx.rng.srand(312);
    updateUnitAI(ctx, clubman, 270);
    const next = new CrtRand();
    next.srand(1057);
    expect(ctx.rng.rand()).toBe(next.rand());
  });
});

describe('unit-ai.md §7 Example 4: a Villager flees a Clubman', () => {
  test('hit by a Clubman 2 tiles east, it stops and runs to (6.099999904632568, 10.5)', () => {
    const w = world({ owner: 1, type: VILLAGER, x: 10.5, y: 10.5 }, { owner: 2, type: CLUBMAN, x: 12.5, y: 10.5 });
    const villager = w.entities.get(1)!;
    const ctx = w.gameContext();
    notifyObject(ctx, villager, 2, NOTIFY_ATTACKED, 2, 22);
    updateUnitAI(ctx, villager, 270);
    const move = villager.mover!.action!;
    expect([move.x, move.y]).toEqual([6.099999904632568, 10.5]);
    expect(villager.ai!.attackers).toEqual([2]);
  });
});

describe('retaliation and help (unit-ai.md §4.2, §4.4)', () => {
  test('an idle Clubman attacked by an enemy Clubman fights back and kills it', () => {
    // The attacker is hurt first so the fight has a winner.
    const w = world({ owner: 1, type: CLUBMAN, x: 10.5, y: 10.5 }, { owner: 2, type: CLUBMAN, x: 11.5, y: 10.5 });
    const [a, b] = [w.entities.get(1)!, w.entities.get(2)!];
    a.hp = 10;
    order(w, 1, { type: 'attack', units: [1], target: 2 });
    runUntil(w, () => b.attack?.target === 1, 20);
    runUntil(w, () => a.hp < 1 || b.hp < 1, 400);
    expect([a.hp, b.hp < 40]).toEqual([0, true]);
    expect(w.attributes[2]![ATTR_KILLS]).toBe(1);
  });

  test('an idle Clubman within 3 tiles of an attacked Clubman answers its call and attacks the attacker', () => {
    const w = world(
      { owner: 1, type: CLUBMAN, x: 10.5, y: 10.5 },
      { owner: 1, type: CLUBMAN, x: 10.5, y: 12.5 },
      { owner: 2, type: BOWMAN, x: 15.5, y: 10.5 },
    );
    const helper = w.entities.get(2)!;
    seeAll(w);
    const ctx = w.gameContext();
    notifyObject(ctx, w.entities.get(1)!, 3, NOTIFY_ATTACKED, 3, 37);
    updateUnitAI(ctx, w.entities.get(1)!, 270);
    expect([helper.ai!.order, helper.ai!.action, helper.ai!.target, helper.attack!.target]).toEqual([AI_ORDER_ATTACK, AI_ACTION_ATTACK, 3, 3]);
  });

  test('a Villager calls no help: its search sees no soldiers (unit-ai.md §3.2 civilian groups)', () => {
    const w = world(
      { owner: 1, type: VILLAGER, x: 10.5, y: 10.5 },
      { owner: 1, type: CLUBMAN, x: 10.5, y: 12.5 },
      { owner: 2, type: CLUBMAN, x: 12.5, y: 10.5 },
    );
    const ctx = w.gameContext();
    notifyObject(ctx, w.entities.get(1)!, 3, NOTIFY_ATTACKED, 3, 22);
    updateUnitAI(ctx, w.entities.get(1)!, 270);
    expect([w.entities.get(2)!.ai!.order, w.entities.get(2)!.attack]).toEqual([-1, undefined]);
  });

  test('a unit attacking keeps fighting until its target dies, then its attack completes', () => {
    const w = world({ owner: 1, type: CLUBMAN, x: 10.5, y: 10.5 }, { owner: 2, type: VILLAGER, x: 11.5, y: 10.5 });
    const clubman = w.entities.get(1)!;
    order(w, 1, { type: 'attack', units: [1], target: 2 });
    runUntil(w, () => !w.entities.get(2) || w.entities.get(2)!.state >= ObjectState.Dying);
    runUntil(w, () => clubman.attack === null || clubman.attack === undefined);
    expect(clubman.ai!.order).toBe(-1);
  });
});

