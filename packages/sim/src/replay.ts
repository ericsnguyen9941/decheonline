import type { Command } from './commands';
import { CrtRand } from './rng';
import { BARRACKS, CLUBMAN, HOUSE, TOWN_CENTER, VILLAGER } from './units';
import { startingObjects, World, type StartUnit } from './world';

/** Everything needed to rerun a game: start state plus every batch, keyed by the turn it was issued on. */
export interface ReplayLog {
  players: number;
  randomSeed: number;
  /** Objects placed before the first step. */
  units?: StartUnit[];
  turns: number;
  batches: { turn: number; player: number; commands: Command[] }[];
}

/** Run a log from the start; returns the state hash after every turn. */
export function runReplay(
  log: ReplayLog,
  world = new World({ players: log.players, randomSeed: log.randomSeed, units: log.units }),
): number[] {
  const hashes: number[] = [];
  while (world.turn < log.turns) {
    for (const b of log.batches) if (b.turn === world.turn) world.addBatch(b.turn, b.player, b.commands);
    world.runTurn();
    hashes.push(world.hash());
  }
  return hashes;
}

/**
 * A fixed log for determinism tests: Gaia plus two players with the test map's starting objects (`startingObjects`),
 * each issuing 0-3 `test` commands per turn at coordinates that are not exact float32 values, so every step exercises
 * float32 rounding. Now and then, spaced so gatherers fill up and drop off, builders finish and units train between
 * orders: a `move` of some of their Villagers (and sometimes one of the other side's, which is ignored) to a random
 * point of the map, water included; a `work` order, mostly on a resource near their base, else on a random starting
 * object (resources, either Town Center, the other side's units) or a missing one; a `build` of a House or Barracks near their Town Center (some spots are taken);
 * a `queue` of Villagers (or a Clubman, or an unqueue) at their Town Center or now and then the other's; and rarely a
 * `cancel` of an object made during the game.
 */
export function sampleReplay(turns = 120, seed = 20260101): ReplayLog {
  const players = 3;
  const units = startingObjects(players);
  const gen = new CrtRand();
  gen.srand(seed);
  // Starting objects get ids 1.. in `units` order.
  const villagers = units.flatMap((u, i) => (u.type === VILLAGER ? [{ id: i + 1, owner: u.owner }] : []));
  const centers = units.flatMap((u, i) => (u.type === TOWN_CENTER ? [{ id: i + 1, owner: u.owner, x: u.x, y: u.y }] : []));
  const resources = units.flatMap((u, i) => (u.owner === 0 ? [{ id: i + 1, x: u.x, y: u.y }] : []));
  const pick = (player: number) => villagers.flatMap((v) => ((v.owner === player || gen.rand() % 8 === 0) && gen.rand() % 3 !== 0 ? [v.id] : []));
  const fraction = () => gen.rand() / 32768;
  const batches: ReplayLog['batches'] = [];
  for (let turn = 0; turn < turns; turn++) {
    for (const player of [2, 1]) {
      const commands: Command[] = [];
      const n = gen.rand() % 4;
      for (let i = 0; i < n; i++) commands.push({ type: 'test', x: gen.rand() / 327.67, y: gen.rand() / 91.3 });
      if (n === 0 && gen.rand() % 2 === 0) commands.push({ type: 'noop' });
      const own = centers.find((c) => c.owner === player)!;
      if (gen.rand() % 64 === 0) {
        const ids = pick(player);
        if (ids.length > 0) commands.push({ type: 'move', units: ids, x: gen.rand() / 682.66, y: gen.rand() / 682.66 });
      }
      if (gen.rand() % 32 === 0) {
        const ids = pick(player);
        const near = resources.filter((r) => Math.abs(r.x - own.x) < 12 && Math.abs(r.y - own.y) < 12);
        const target = gen.rand() % 4 !== 0 ? near[gen.rand() % near.length]!.id : (gen.rand() % (units.length + 4)) + 1;
        const at = units[target - 1] ?? { x: gen.rand() / 682.66, y: gen.rand() / 682.66 };
        if (ids.length > 0) commands.push({ type: 'work', units: ids, target, x: at.x, y: at.y });
      }
      if (gen.rand() % 48 === 0) {
        const ids = pick(player);
        const unitType = gen.rand() % 3 === 0 ? BARRACKS : HOUSE;
        const x = own.x + (gen.rand() % 11) - 5 + fraction();
        const y = own.y + (gen.rand() % 11) - 5 + fraction();
        commands.push({ type: 'build', units: ids, unitType, x, y });
      }
      if (gen.rand() % 16 === 0) {
        const building = gen.rand() % 8 === 0 ? centers.find((c) => c.owner !== player)!.id : own.id;
        const unit = gen.rand() % 6 === 0 ? CLUBMAN : VILLAGER;
        const count = gen.rand() % 5 === 0 ? -1 : 1 + (gen.rand() % 3);
        commands.push({ type: 'queue', building, unit, count });
      }
      if (gen.rand() % 60 === 0) commands.push({ type: 'cancel', target: units.length + 1 + (gen.rand() % 40) });
      if (commands.length > 0) batches.push({ turn, player, commands });
    }
  }
  return { players, randomSeed: 4242, units, turns, batches };
}
