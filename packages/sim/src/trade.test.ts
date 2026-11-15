import { describe, expect, test } from 'vitest';
import { parseCommand, type Command } from './commands';
import { ObjectState, type Entity } from './entities';
import { TileMap } from './map';
import { master, typeOf } from './masters';
import { add32, f32 } from './num';
import { runReplay, sampleTradeReplay } from './replay';
import { TECH_AVAILABLE, TECH_DONE } from './techs';
import { ACTION_TRADE, ATTR_TRADE_GOODS, tradeGold } from './trade';
import { TOWN_CENTER } from './units';
import { VICTORY_SPECIAL } from './victory';
import { AGE_BRONZE, World, type StartUnit } from './world';

const DOCK = 45;
const TRADE_BOAT = 15;
const MERCHANT_SHIP = 16;
const TECH_MERCHANT_SHIP = 6;
const CIV_EGYPTIAN = 1;
const CIV_PALMYRAN = 15;
const FOOD = 0;
const WOOD = 1;
const GOLD = 3;
const GOLD_EARNED = 49;

/** `navalTerrain`'s columns (west land 0-14, beach 15, sea 16-27 with deep water 21-22, beach 28, east land 29-63), 64 × 64. */
function longSea(): TileMap {
  const tiles: number[] = [];
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) tiles.push(x === 15 || x === 28 ? 2 : x >= 16 && x <= 27 ? (x === 21 || x === 22 ? 22 : 1) : 0);
  }
  return new TileMap(64, 64, tiles);
}

/** Player 1's Town Center and Dock at the north-west end, player 2's at the south-east end, 53 rows apart. */
const HOME: StartUnit[] = [
  { owner: 1, type: TOWN_CENTER, x: 6.5, y: 6.5 },
  { owner: 1, type: DOCK, x: 16.5, y: 5.5 },
  { owner: 2, type: TOWN_CENTER, x: 34.5, y: 58.5 },
  { owner: 2, type: DOCK, x: 27.5, y: 58.5 },
];
const HOME_DOCK = 2;
const FOREIGN_DOCK = 4;

/** Gaia and two players on the long sea with `HOME` and these objects (ids from 5 in list order); conquest off. */
function world(units: StartUnit[], options: { civs?: [number, number]; startingAge?: number } = {}): World {
  const [a, b] = options.civs ?? [CIV_EGYPTIAN, CIV_EGYPTIAN];
  return new World({ players: 3, civs: [0, a, b], map: longSea(), units: [...HOME, ...units], startingAge: options.startingAge, victory: { type: VICTORY_SPECIAL } });
}

/** A Trade Boat of player 1 off its Dock: id 5. */
function boatWorld(options: { civs?: [number, number]; startingAge?: number } = {}): { w: World; boat: Entity; home: Entity; foreign: Entity } {
  const w = world([{ owner: 1, type: TRADE_BOAT, x: 18.5, y: 8.5 }], options);
  return { w, boat: w.entities.get(5)!, home: w.entities.get(HOME_DOCK)!, foreign: w.entities.get(FOREIGN_DOCK)! };
}

function order(w: World, player: number, command: Command): void {
  w.addBatch(w.turn, player, [command]);
}

function runUntil(w: World, done: () => boolean, limit: number): void {
  for (let turns = 0; !done() && turns < limit; turns++) w.runTurn();
  expect(done()).toBe(true);
}

function live(w: World, owner: number, type: number): Entity[] {
  return [...w.entities.all()].filter((e) => e.owner === owner && e.type === type && e.state <= ObjectState.Active);
}

describe('support-actions.md §7.2: the gold a cargo earns', () => {
  test('§10.5 vectors: distance squared × 0.00025125628 × 0.7 per unit, at least 0.35, doubled for a Palmyran, at most 75', () => {
    expect(tradeGold(20, 10.5, 10.5, 60.5, 70.5, false)).toBe(f32(21.457287));
    expect(tradeGold(20, 10.5, 10.5, 60.5, 70.5, true)).toBe(f32(42.914574));
    expect(tradeGold(20, 20.5, 20.5, 30.5, 25.5, false)).toBe(7);
    expect(tradeGold(20, 5.5, 5.5, 125.5, 105.5, false)).toBe(75);
    // No pick-up point: the minimum.
    expect(tradeGold(20, -1, -1, 30.5, 25.5, false)).toBe(7);
  });
});

describe('support-actions.md §7: trade boats', () => {
  test('an idle Trade Boat holds its default Trade action (111) in state 2, its cargo set to wood', () => {
    const { w, boat } = boatWorld();
    w.runTurn();
    expect([boat.work?.type, boat.work?.state, boat.heldType]).toEqual([ACTION_TRADE, 2, WOOD]);
  });

  test("sent to the other player's Dock, it loads 20 wood against that player's trade goods, sails home and is paid the distance in gold, round after round", () => {
    const { w, boat, home, foreign } = boatWorld();
    const own = w.attributes[1]!;
    own[WOOD] = 1000;
    w.attributes[2]![ATTR_TRADE_GOODS] = 100;
    const gold0 = own[GOLD]!;
    order(w, 1, { type: 'work', units: [boat.id], target: foreign.id, x: foreign.x, y: foreign.y });
    w.runTurn();
    w.runTurn();
    w.runTurn();
    expect([boat.work?.type, boat.work?.state, boat.work?.target]).toEqual([ACTION_TRADE, 4, foreign.id]);
    // One trip pays (27.5 − 16.5)² + (58.5 − 5.5)² = 2930 squared tiles × 0.00025125628 × 0.7 per unit.
    const trip = tradeGold(20, foreign.x, foreign.y, home.x, home.y, false);
    expect(trip).toBe(f32(20 * f32(f32(2930 * f32(0.00025125628)) * f32(0.7))));
    expect(trip).toBeCloseTo(10.307, 3);
    let gold = gold0;
    for (let round = 1; round <= 3; round++) {
      // Loading takes the whole cargo in one step, then the boat heads home.
      runUntil(w, () => boat.heldAmount > 0, 4000);
      expect([boat.work?.state, boat.heldType, boat.heldAmount]).toEqual([8, WOOD, 20]);
      expect([boat.work?.pickUpX, boat.work?.pickUpY]).toEqual([foreign.x, foreign.y]);
      expect(own[WOOD]).toBe(1000 - 20 * round);
      runUntil(w, () => boat.heldAmount === 0, 4000);
      gold = add32(trip, gold);
      expect([own[GOLD], own[GOLD_EARNED], boat.work?.state, boat.work?.target]).toEqual([gold, add32(gold, -gold0), 4, foreign.id]);
    }
    expect(w.attributes[2]![ATTR_TRADE_GOODS]).toBeLessThanOrEqual(100);
  });

  test('a Dock keeps the boat loading while the trade goods regrow (1 a second, up to 100)', () => {
    const { w, boat, foreign } = boatWorld();
    w.attributes[1]![WOOD] = 1000;
    order(w, 1, { type: 'work', units: [boat.id], target: foreign.id, x: foreign.x, y: foreign.y });
    const goods = w.attributes[2]!;
    // Player 2 has no goods when the boat arrives: it waits at the Dock, loading what regrows.
    runUntil(
      w,
      () => {
        if (boat.heldAmount === 0) goods[ATTR_TRADE_GOODS] = 0;
        return boat.heldAmount > 0;
      },
      4000,
    );
    expect(boat.work?.state).toBe(7);
    expect(boat.heldAmount).toBeLessThan(20);
    expect(goods[ATTR_TRADE_GOODS]).toBe(0);
    const seen: number[] = [];
    runUntil(
      w,
      () => {
        if (seen.at(-1) !== boat.heldAmount) seen.push(boat.heldAmount);
        return boat.work?.state === 8;
      },
      4000,
    );
    expect(seen.at(-1)).toBe(20);
    for (let i = 1; i < seen.length; i++) expect(seen[i]! - seen[i - 1]!).toBeLessThanOrEqual(2);
    expect(w.attributes[1]![WOOD]).toBe(980);
    // Once nobody trades, every player's goods regrow to 100 and stop there.
    for (let t = 0; t < 1500; t++) w.runTurn();
    expect([w.attributes[1]![ATTR_TRADE_GOODS], goods[ATTR_TRADE_GOODS]]).toEqual([100, 100]);
  });

  test('the trade-attribute command sets the cargo: food is loaded and spent instead of wood; another player’s boat is ignored', () => {
    expect(parseCommand({ type: 'trade-attribute', units: [5], attribute: 0 })).toEqual({ type: 'trade-attribute', units: [5], attribute: 0 });
    expect(parseCommand({ type: 'trade-attribute', units: [5], attribute: 3 })).toBeNull();
    expect(parseCommand({ type: 'trade-attribute', units: [], attribute: 1 })).toBeNull();
    const { w, boat, foreign } = boatWorld();
    const own = w.attributes[1]!;
    own[FOOD] = 1000;
    own[WOOD] = 1000;
    w.attributes[2]![ATTR_TRADE_GOODS] = 100;
    order(w, 2, { type: 'trade-attribute', units: [boat.id], attribute: 2 });
    for (let i = 0; i < 3; i++) w.runTurn();
    expect(boat.heldType).toBe(WOOD);
    order(w, 1, { type: 'trade-attribute', units: [boat.id], attribute: FOOD });
    order(w, 1, { type: 'work', units: [boat.id], target: foreign.id, x: foreign.x, y: foreign.y });
    runUntil(w, () => boat.work?.state === 8, 4000);
    expect([boat.heldType, boat.heldAmount, own[FOOD], own[WOOD]]).toEqual([FOOD, 20, 980, 1000]);
  });

  test('a Palmyran boat earns twice the gold', () => {
    const { w, boat, home, foreign } = boatWorld({ civs: [CIV_PALMYRAN, CIV_EGYPTIAN] });
    w.attributes[1]![WOOD] = 1000;
    w.attributes[2]![ATTR_TRADE_GOODS] = 100;
    const gold0 = w.attributes[1]![GOLD]!;
    order(w, 1, { type: 'work', units: [boat.id], target: foreign.id, x: foreign.x, y: foreign.y });
    runUntil(w, () => w.attributes[1]![GOLD_EARNED]! > 0, 8000);
    const trip = tradeGold(20, foreign.x, foreign.y, home.x, home.y, true);
    expect(trip).toBe(add32(tradeGold(20, foreign.x, foreign.y, home.x, home.y, false), tradeGold(20, foreign.x, foreign.y, home.x, home.y, false)));
    expect(w.attributes[1]![GOLD]).toBe(add32(trip, gold0));
  });

  test('an own Dock is no trade target: right-clicked, it becomes the home Dock and nothing is traded', () => {
    const { w, boat, home } = boatWorld();
    w.attributes[1]![WOOD] = 1000;
    w.attributes[1]![ATTR_TRADE_GOODS] = 100;
    const gold0 = w.attributes[1]![GOLD];
    order(w, 1, { type: 'work', units: [boat.id], target: home.id, x: home.x, y: home.y });
    for (let i = 0; i < 100; i++) w.runTurn();
    expect([w.attributes[1]![WOOD], w.attributes[1]![GOLD], boat.heldAmount]).toEqual([1000, gold0, 0]);
    expect(boat.work?.type).toBe(ACTION_TRADE);
  });

  test('a loaded boat whose foreign Dock is destroyed still sails home and is paid', () => {
    const { w, boat, home, foreign } = boatWorld();
    w.attributes[1]![WOOD] = 1000;
    w.attributes[2]![ATTR_TRADE_GOODS] = 100;
    const gold0 = w.attributes[1]![GOLD]!;
    order(w, 1, { type: 'work', units: [boat.id], target: foreign.id, x: foreign.x, y: foreign.y });
    runUntil(w, () => boat.work?.state === 8, 4000);
    foreign.hp = 0;
    runUntil(w, () => boat.heldAmount === 0, 4000);
    expect(w.attributes[1]![GOLD]).toBe(add32(tradeGold(20, foreign.x, foreign.y, home.x, home.y, false), gold0));
    // With no target left the boat asks its unit AI for a task, which finds its own Dock: it trades with nobody.
    for (let i = 0; i < 50; i++) w.runTurn();
    expect([boat.heldAmount, w.attributes[1]![WOOD]]).toEqual([0, 980]);
  });

  test('the Dock trains the Trade Boat; Merchant Ship (6, Bronze Age) makes it the Merchant Ship (16): 250 hp, speed 2.5', () => {
    const { w, boat, home } = boatWorld({ startingAge: AGE_BRONZE });
    for (const r of [0, 1, 2, 3]) w.attributes[1]![r] = 50000;
    order(w, 1, { type: 'queue', building: home.id, unit: TRADE_BOAT, count: 1 });
    runUntil(w, () => live(w, 1, TRADE_BOAT).length === 2, 3000);
    const t = master(w, 1, TRADE_BOAT);
    expect([t.hitPoints, t.speed, t.resourceCapacity, t.group, t.unitLevel]).toEqual([200, 2, 20, 2, 5]);
    expect(t.creatable!.costs[0]).toEqual({ type: WOOD, amount: 100, flag: 1 });
    expect(w.techs[1]![TECH_MERCHANT_SHIP]).toBe(TECH_AVAILABLE);
    order(w, 1, { type: 'research', building: home.id, tech: TECH_MERCHANT_SHIP });
    runUntil(w, () => w.techs[1]![TECH_MERCHANT_SHIP] === TECH_DONE, 3000);
    const m = master(w, 1, TRADE_BOAT);
    const source = master(w, 1, MERCHANT_SHIP);
    expect([m.hitPoints, m.speed, m.standing.graphic, m.resourceCapacity]).toEqual([250, 2.5, 50, 20]);
    expect([source.hitPoints, source.speed]).toEqual([250, 2.5]);
    // A boat afloat keeps its share of hit points under the new maximum.
    expect([typeOf(w, boat).hitPoints, boat.hp]).toEqual([250, 250]);
  });
});

describe('determinism: the trade replay', () => {
  test('sampleTradeReplay loads cargo and earns both sides gold; two runs hash alike', () => {
    const log = sampleTradeReplay();
    const terrain = log.terrain!;
    const w = new World({ players: log.players, randomSeed: log.randomSeed, units: log.units, map: new TileMap(terrain.width, terrain.height, terrain.tiles), civs: log.civs, ...log.start });
    const a = runReplay(log, w);
    expect([w.attributes[1]![GOLD_EARNED]! > 0, w.attributes[2]![GOLD_EARNED]! > 0]).toEqual([true, true]);
    expect(runReplay(sampleTradeReplay())).toEqual(a);
  });
});
