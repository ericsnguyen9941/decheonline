import { describe, expect, test } from 'vitest';
import { AI_ACTION_ATTACK } from './unit-ai';
import { parseCommand, type Command } from './commands';
import { ATTR_TRIBUTE_FEE, ATTR_TRIBUTE_SENT, RELATION_ALLY, RELATION_ENEMY, RELATION_NEUTRAL, type DiplomacyState, newDiplomacy } from './diplomacy';
import { ObjectState } from './entities';
import { mul32, MS_TO_SECONDS } from './num';
import { runReplay, sampleDiplomacyReplay } from './replay';
import { doEffect } from './techs';
import { CLUBMAN, MARKET, VILLAGER, WATCH_TOWER } from './units';
import {
  checkGameState,
  END_CONQUEST,
  newVictory,
  STATUS_LOST,
  STATUS_PLAYING,
  STATUS_WON,
  VICTORY_SCORE,
  VICTORY_SPECIAL,
  VICTORY_STANDARD,
  winGameNow,
} from './victory';
import { TILE_BLACK, TILE_VISIBLE } from './visibility';
import { STEP_MS, World, type Snapshot, type StartUnit } from './world';

const DT = mul32(STEP_MS, MS_TO_SECONDS);
const FOOD = 0;
const WOOD = 1;
const STONE = 2;
const GOLD = 3;
/** Writing's effect: attribute 50 + 1 (tech 114, empires.dat effect 113). */
const WRITING_EFFECT = 113;
/** Coinage's effect: attribute 46 = 0 (tech 30, empires.dat effect 30). */
const COINAGE_EFFECT = 30;

/** Gaia and two players with these objects, ids from 1 in list order; conquest off so an empty side does not end it. */
function world(...units: StartUnit[]): World {
  return new World({ players: 3, units, victory: { type: VICTORY_SPECIAL } });
}

/** A Villager each, far apart: both players stay in the game. */
const twoVillagers = (): StartUnit[] => [
  { owner: 1, type: VILLAGER, x: 10.5, y: 10.5 },
  { owner: 2, type: VILLAGER, x: 30.5, y: 30.5 },
];

/** Issue `command` for `player` now and run until it has executed (2 turns later) and one more turn. */
function order(w: World, player: number, command: Command): void {
  w.addBatch(w.turn, player, [command]);
  for (let i = 0; i < 3; i++) w.runTurn();
}

describe('diplomacy.md §1, §4: stances and the relation command', () => {
  test('at game start every player calls every other an enemy and Gaia neutral; allied victory and LOS are off', () => {
    const w = world(...twoVillagers());
    expect(w.diplomacy.relations).toEqual([
      [RELATION_NEUTRAL, RELATION_ENEMY, RELATION_ENEMY],
      [RELATION_NEUTRAL, RELATION_NEUTRAL, RELATION_ENEMY],
      [RELATION_NEUTRAL, RELATION_ENEMY, RELATION_NEUTRAL],
    ]);
    expect([w.isEnemy(1, 2), w.isAlly(1, 2), w.isAlly(1, 1), w.isEnemy(1, 0)]).toEqual([true, false, true, false]);
    expect(w.diplomacy.alliedVictory).toEqual([false, false, false]);
    expect(w.diplomacy.alliedLos).toEqual([false, false, false]);
  });

  test("a stance is one-sided: player 1 calls 2 an ally, 2 still calls 1 an enemy; then neutral, then enemy again", () => {
    const w = world(...twoVillagers());
    order(w, 1, { type: 'relation', player: 2, relation: RELATION_ALLY });
    expect([w.relation(1, 2), w.relation(2, 1), w.isAlly(1, 2), w.isAlly(2, 1)]).toEqual([RELATION_ALLY, RELATION_ENEMY, true, false]);
    order(w, 1, { type: 'relation', player: 2, relation: RELATION_NEUTRAL });
    expect([w.relation(1, 2), w.isAlly(1, 2), w.isEnemy(1, 2)]).toEqual([RELATION_NEUTRAL, false, false]);
    order(w, 1, { type: 'relation', player: 2, relation: RELATION_ENEMY });
    expect(w.relation(1, 2)).toBe(RELATION_ENEMY);
  });

  test("a player changes only its own stance: towards itself, Gaia, a missing or a defeated player it is ignored", () => {
    const w = world({ owner: 1, type: VILLAGER, x: 10.5, y: 10.5 });
    // Player 2's command changes player 2's stance, never player 1's.
    order(w, 2, { type: 'relation', player: 1, relation: RELATION_ALLY });
    expect([w.relation(2, 1), w.relation(1, 2)]).toEqual([RELATION_ALLY, RELATION_ENEMY]);
    const before = JSON.stringify(w.diplomacy);
    order(w, 2, { type: 'relation', player: 2, relation: RELATION_ALLY });
    order(w, 2, { type: 'relation', player: 0, relation: RELATION_ALLY });
    order(w, 2, { type: 'relation', player: 5, relation: RELATION_ALLY });
    expect(JSON.stringify(w.diplomacy)).toBe(before);
    // Player 2 has no objects: lost at its first per-second check.
    expect(w.playerStatus(2)).toBe(STATUS_LOST);
    order(w, 1, { type: 'relation', player: 2, relation: RELATION_ALLY });
    expect(w.relation(1, 2)).toBe(RELATION_ENEMY);
  });

  test('parse: ally, neutral and enemy only; players 0-8; tribute of resource 0-3 and an amount above 0; unknown fields dropped', () => {
    expect(parseCommand({ type: 'relation', player: 2, relation: 0, from: 1 })).toEqual({ type: 'relation', player: 2, relation: 0 });
    expect(parseCommand({ type: 'relation', player: 2, relation: 2 })).toBeNull();
    expect(parseCommand({ type: 'relation', player: 9, relation: 3 })).toBeNull();
    expect(parseCommand({ type: 'relation', player: 1.5, relation: 3 })).toBeNull();
    expect(parseCommand({ type: 'allied-victory', on: true })).toEqual({ type: 'allied-victory', on: true });
    expect(parseCommand({ type: 'allied-victory', on: 1 })).toBeNull();
    expect(parseCommand({ type: 'tribute', player: 2, resource: 3, amount: 100, from: 2 })).toEqual({ type: 'tribute', player: 2, resource: 3, amount: 100 });
    expect(parseCommand({ type: 'tribute', player: 2, resource: 4, amount: 100 })).toBeNull();
    expect(parseCommand({ type: 'tribute', player: 2, resource: 0, amount: 0 })).toBeNull();
    expect(parseCommand({ type: 'tribute', player: 2, resource: 0, amount: -5 })).toBeNull();
    expect(parseCommand({ type: 'tribute', player: 2, resource: 0, amount: Infinity })).toBeNull();
  });

  test('a snapshot keeps the stances, flags and the mutual-ally masks', () => {
    const w = world(...twoVillagers());
    order(w, 1, { type: 'relation', player: 2, relation: RELATION_ALLY });
    order(w, 2, { type: 'relation', player: 1, relation: RELATION_ALLY });
    order(w, 2, { type: 'allied-victory', on: true });
    doEffect(w.gameContext(), 1, WRITING_EFFECT);
    const restored = World.restore(JSON.parse(JSON.stringify(w.snapshot())) as Snapshot);
    expect(restored.diplomacy).toEqual(w.diplomacy);
    expect(restored.visibility.mutualVisible).toEqual(w.visibility.mutualVisible);
    expect(restored.hash()).toBe(w.hash());
  });
});

describe('diplomacy.md §2: stances and attacks', () => {
  const clubmanAndVillager = () => world({ owner: 1, type: CLUBMAN, x: 10.5, y: 10.5 }, { owner: 2, type: VILLAGER, x: 13.5, y: 10.5 });

  test('an idle Clubman does not auto-attack a Villager of a player its owner calls an ally', () => {
    const w = clubmanAndVillager();
    w.diplomacy.relations[1]![2] = RELATION_ALLY;
    for (let i = 0; i < 30; i++) w.runTurn();
    expect([w.entities.get(1)!.ai!.target, w.entities.get(1)!.attack ?? null]).toEqual([-1, null]);
  });

  test("allied one way only: the other side's Clubman still auto-attacks", () => {
    const w = world({ owner: 1, type: VILLAGER, x: 10.5, y: 10.5 }, { owner: 2, type: CLUBMAN, x: 13.5, y: 10.5 });
    w.diplomacy.relations[1]![2] = RELATION_ALLY;
    for (let i = 0; i < 30 && w.entities.get(2)!.ai!.target === -1; i++) w.runTurn();
    expect([w.entities.get(2)!.ai!.action, w.entities.get(2)!.attack!.target]).toEqual([AI_ACTION_ATTACK, 1]);
  });

  test('neutral: a Clubman leaves a neutral Villager alone but auto-attacks a neutral Clubman', () => {
    const w = clubmanAndVillager();
    w.diplomacy.relations[1]![2] = RELATION_NEUTRAL;
    for (let i = 0; i < 30; i++) w.runTurn();
    expect(w.entities.get(1)!.ai!.target).toBe(-1);
    const v = world({ owner: 1, type: CLUBMAN, x: 10.5, y: 10.5 }, { owner: 2, type: CLUBMAN, x: 13.5, y: 10.5 });
    v.diplomacy.relations[1]![2] = RELATION_NEUTRAL;
    v.diplomacy.relations[2]![1] = RELATION_NEUTRAL;
    for (let i = 0; i < 30 && v.entities.get(1)!.ai!.target === -1; i++) v.runTurn();
    expect(v.entities.get(1)!.attack!.target).toBe(2);
  });

  test('a Watch Tower shoots an enemy Villager in range but not a neutral one', () => {
    const shoots = (stance: number) => {
      const w = world({ owner: 1, type: WATCH_TOWER, x: 10.5, y: 10.5 }, { owner: 2, type: VILLAGER, x: 13.5, y: 10.5 });
      w.diplomacy.relations[1]![2] = stance;
      for (let i = 0; i < 30 && w.entities.get(1)!.ai!.target === -1; i++) w.runTurn();
      return w.entities.get(1)!.ai!.target;
    };
    expect([shoots(RELATION_ENEMY), shoots(RELATION_NEUTRAL), shoots(RELATION_ALLY)]).toEqual([2, -1, -1]);
  });

  test('an attack under way ends when the attacker owner turns ally (target invalid), and is not taken up again', () => {
    const w = clubmanAndVillager();
    const clubman = w.entities.get(1)!;
    for (let i = 0; i < 30 && clubman.ai!.target === -1; i++) w.runTurn();
    expect(clubman.attack!.target).toBe(2);
    order(w, 1, { type: 'relation', player: 2, relation: RELATION_ALLY });
    for (let i = 0; i < 20; i++) w.runTurn();
    expect([clubman.attack ?? null, clubman.ai!.action]).toEqual([null, -1]);
    expect(w.entities.get(2)!.state).toBe(ObjectState.Active);
  });

  test("a right-click attack order on an ally's unit finds no task; on a neutral's it attacks", () => {
    const w = clubmanAndVillager();
    w.diplomacy.relations[1]![2] = RELATION_ALLY;
    order(w, 1, { type: 'attack', units: [1], target: 2 });
    expect(w.entities.get(1)!.attack ?? null).toBeNull();
    w.diplomacy.relations[1]![2] = RELATION_NEUTRAL;
    order(w, 1, { type: 'attack', units: [1], target: 2 });
    expect(w.entities.get(1)!.attack!.target).toBe(2);
  });
});

describe('diplomacy.md §3: allied line of sight (Writing)', () => {
  // Player 1 near (10, 10), player 2 near (30, 30): neither sees the other's base.
  const apart = () => world({ owner: 1, type: VILLAGER, x: 10.5, y: 10.5 }, { owner: 2, type: VILLAGER, x: 30.5, y: 30.5 });

  test('with Writing and a mutual alliance a player sees what its ally sees; its ally, without Writing, does not', () => {
    const w = apart();
    w.runTurn();
    expect([w.tileVisibility(1, 30, 30), w.tileVisibility(2, 10, 10)]).toEqual([TILE_BLACK, TILE_BLACK]);
    order(w, 1, { type: 'relation', player: 2, relation: RELATION_ALLY });
    order(w, 2, { type: 'relation', player: 1, relation: RELATION_ALLY });
    expect(w.tileVisibility(1, 30, 30)).toBe(TILE_BLACK);
    doEffect(w.gameContext(), 1, WRITING_EFFECT);
    expect(w.diplomacy.alliedLos).toEqual([false, true, false]);
    expect([w.tileVisibility(1, 30, 30), w.tileVisibility(2, 10, 10)]).toEqual([TILE_VISIBLE, TILE_BLACK]);
  });

  test('Writing with a one-sided alliance shares nothing; breaking the alliance takes the shared view away', () => {
    const w = apart();
    doEffect(w.gameContext(), 1, WRITING_EFFECT);
    order(w, 1, { type: 'relation', player: 2, relation: RELATION_ALLY });
    expect(w.tileVisibility(1, 30, 30)).toBe(TILE_BLACK);
    order(w, 2, { type: 'relation', player: 1, relation: RELATION_ALLY });
    expect(w.tileVisibility(1, 30, 30)).toBe(TILE_VISIBLE);
    order(w, 2, { type: 'relation', player: 1, relation: RELATION_NEUTRAL });
    expect(w.tileVisibility(1, 30, 30)).toBe(TILE_BLACK);
  });
});

describe('diplomacy.md §6: allied victory', () => {
  /** Gaia and three players; 1 and 2 mutual allies, with the given allied-victory flags. */
  function alliance(av1: boolean, av2: boolean): DiplomacyState {
    const d = newDiplomacy(4);
    d.relations[1]![2] = RELATION_ALLY;
    d.relations[2]![1] = RELATION_ALLY;
    d.alliedVictory[1] = av1;
    d.alliedVictory[2] = av2;
    return d;
  }

  test('conquest: two mutual allies with allied victory win together once the third player is out', () => {
    const v = newVictory(4, { type: VICTORY_STANDARD });
    v.status[3] = STATUS_LOST;
    checkGameState(v, DT, [[], [], [], []], alliance(true, true));
    expect([v.gameState, v.endCondition, v.status.slice(1)]).toEqual([1, END_CONQUEST, [STATUS_WON, STATUS_WON, STATUS_LOST]]);
  });

  test('conquest: without allied victory on the second ally (or without the alliance) the game goes on', () => {
    for (const d of [alliance(true, false), newDiplomacy(4)]) {
      const v = newVictory(4, { type: VICTORY_STANDARD });
      v.status[3] = STATUS_LOST;
      checkGameState(v, DT, [[], [], [], []], d);
      expect([v.gameState, v.status[1], v.status[2]]).toEqual([0, STATUS_PLAYING, STATUS_PLAYING]);
    }
  });

  test('win_game_now: the winner\'s mutual ally with allied victory wins too, everyone else loses', () => {
    const v = newVictory(4, { type: VICTORY_STANDARD });
    winGameNow(v, 1, alliance(true, true));
    expect(v.status.slice(1)).toEqual([STATUS_WON, STATUS_WON, STATUS_LOST]);
    const u = newVictory(4, { type: VICTORY_STANDARD });
    winGameNow(u, 1, alliance(true, false));
    expect(u.status.slice(1)).toEqual([STATUS_WON, STATUS_LOST, STATUS_LOST]);
  });

  test('check_victory: with allied victory a player whose conditions are met waits for its allies to meet theirs', () => {
    const v = newVictory(4, { type: VICTORY_SCORE, amount: 100 });
    const d = alliance(true, true);
    v.verdicts[1] = 2;
    checkGameState(v, DT, [[], [], [], []], d);
    expect([v.gameState, v.status[1]]).toEqual([0, STATUS_PLAYING]);
    v.verdicts[2] = 2;
    checkGameState(v, DT, [[], [], [], []], d);
    expect([v.gameState, v.status.slice(1)]).toEqual([1, [STATUS_WON, STATUS_WON, STATUS_LOST]]);
  });

  test('the allied-victory command sets the sender\'s flag only', () => {
    const w = world(...twoVillagers());
    order(w, 2, { type: 'allied-victory', on: true });
    expect(w.diplomacy.alliedVictory).toEqual([false, false, true]);
    order(w, 2, { type: 'allied-victory', on: false });
    expect(w.diplomacy.alliedVictory).toEqual([false, false, false]);
  });
});

describe('diplomacy.md §5: tribute', () => {
  /** Player 1 with a built Market and 1000 of each resource; player 2 with 0 of each. */
  function market(): World {
    const w = world({ owner: 1, type: MARKET, x: 10.5, y: 10.5 }, { owner: 2, type: VILLAGER, x: 30.5, y: 30.5 });
    expect(w.entities.get(1)!.state).toBe(ObjectState.Active);
    for (const r of [FOOD, WOOD, STONE, GOLD]) {
      w.attributes[1]![r] = 1000;
      w.attributes[2]![r] = 0;
    }
    return w;
  }

  test('each resource: 100 sent costs 125 at the 25% fee; attribute 53 counts +125 for the sender, -100 for the receiver', () => {
    const w = market();
    expect(w.attributes[1]![ATTR_TRIBUTE_FEE]).toBe(0.25);
    for (const r of [FOOD, WOOD, STONE, GOLD]) order(w, 1, { type: 'tribute', player: 2, resource: r, amount: 100 });
    expect([FOOD, WOOD, STONE, GOLD].map((r) => [w.attributes[1]![r], w.attributes[2]![r]])).toEqual([
      [875, 100],
      [875, 100],
      [875, 100],
      [875, 100],
    ]);
    expect([w.attributes[1]![ATTR_TRIBUTE_SENT], w.attributes[2]![ATTR_TRIBUTE_SENT]]).toEqual([500, -400]);
  });

  test('after Coinage (fee 0) 100 sent costs 100', () => {
    const w = market();
    doEffect(w.gameContext(), 1, COINAGE_EFFECT);
    expect(w.attributes[1]![ATTR_TRIBUTE_FEE]).toBe(0);
    order(w, 1, { type: 'tribute', player: 2, resource: GOLD, amount: 100 });
    expect([w.attributes[1]![GOLD], w.attributes[2]![GOLD]]).toEqual([900, 100]);
  });

  test('too little in stock: everything goes, the fee takes 25% of it and the receiver gets 75%', () => {
    const w = market();
    w.attributes[1]![GOLD] = 100;
    order(w, 1, { type: 'tribute', player: 2, resource: GOLD, amount: 100 });
    expect([w.attributes[1]![GOLD], w.attributes[2]![GOLD], w.attributes[1]![ATTR_TRIBUTE_SENT]]).toEqual([0, 75, 100]);
    w.attributes[1]![WOOD] = 90;
    order(w, 1, { type: 'tribute', player: 2, resource: WOOD, amount: 500 });
    expect([w.attributes[1]![WOOD], w.attributes[2]![WOOD]]).toEqual([0, 67.5]);
    order(w, 1, { type: 'tribute', player: 2, resource: WOOD, amount: 500 });
    expect([w.attributes[1]![WOOD], w.attributes[2]![WOOD]]).toEqual([0, 67.5]);
  });

  test('without an active Market nothing is sent', () => {
    const w = world({ owner: 1, type: VILLAGER, x: 10.5, y: 10.5 }, { owner: 2, type: MARKET, x: 30.5, y: 30.5 });
    w.attributes[1]![GOLD] = 1000;
    order(w, 1, { type: 'tribute', player: 2, resource: GOLD, amount: 100 });
    expect([w.attributes[1]![GOLD], w.attributes[2]![GOLD]]).toEqual([1000, 0]);
  });

  test("a player sends only its own resources: to itself, Gaia or a missing player it is ignored; another's command spends the sender's", () => {
    const w = market();
    order(w, 1, { type: 'tribute', player: 1, resource: GOLD, amount: 100 });
    order(w, 1, { type: 'tribute', player: 0, resource: GOLD, amount: 100 });
    order(w, 1, { type: 'tribute', player: 7, resource: GOLD, amount: 100 });
    expect([w.attributes[0]![GOLD], w.attributes[1]![GOLD], w.attributes[2]![GOLD]]).toEqual([0, 1000, 0]);
    // Player 2 asks for player 1's gold: the command can only spend player 2's, and player 2 has no Market.
    order(w, 2, { type: 'tribute', player: 1, resource: GOLD, amount: 100 });
    expect([w.attributes[1]![GOLD], w.attributes[2]![GOLD]]).toEqual([1000, 0]);
  });
});

describe('determinism with diplomacy', () => {
  test('sampleDiplomacyReplay changes stances, sends tribute, and replays to the same hashes', () => {
    const log = sampleDiplomacyReplay(80);
    const kinds = new Set(log.batches.flatMap((b) => b.commands.map((c) => c.type)));
    expect(['relation', 'allied-victory', 'tribute'].every((k) => kinds.has(k as Command['type']))).toBe(true);
    const w = new World({ players: log.players, randomSeed: log.randomSeed, units: log.units });
    const a = runReplay(log, w);
    expect(runReplay(log)).toEqual(a);
    expect(w.attributes[1]![ATTR_TRIBUTE_SENT]! !== 0 || w.attributes[2]![ATTR_TRIBUTE_SENT]! !== 0).toBe(true);
    expect(JSON.stringify(w.diplomacy.relations)).not.toBe(JSON.stringify(newDiplomacy(3).relations));
  });
});
