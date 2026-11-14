import type { Command } from './commands';
import { CrtRand } from './rng';
import { startingUnits, World, type StartUnit } from './world';

/** Everything needed to rerun a game: start state plus every batch, keyed by the turn it was issued on. */
export interface ReplayLog {
  players: number;
  randomSeed: number;
  /** Units placed before the first step. */
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
 * A fixed log for determinism tests: Gaia plus two players with their starting Villagers, each issuing 0-3 `test`
 * commands per turn at coordinates that are not exact float32 values, so every step exercises float32 rounding,
 * and now and then a `move` of some of their Villagers (and sometimes one of the other side's, which is ignored)
 * to a random point of the map, water included.
 */
export function sampleReplay(turns = 120, seed = 20260101): ReplayLog {
  const players = 3;
  const units = startingUnits(players);
  const gen = new CrtRand();
  gen.srand(seed);
  const batches: ReplayLog['batches'] = [];
  for (let turn = 0; turn < turns; turn++) {
    for (const player of [2, 1]) {
      const commands: Command[] = [];
      const n = gen.rand() % 4;
      for (let i = 0; i < n; i++) commands.push({ type: 'test', x: gen.rand() / 327.67, y: gen.rand() / 91.3 });
      if (n === 0 && gen.rand() % 2 === 0) commands.push({ type: 'noop' });
      if (gen.rand() % 3 === 0) {
        // Starting units get ids 1.. in `units` order.
        const ids = units.flatMap((u, i) => (u.owner === player || gen.rand() % 8 === 0) && gen.rand() % 3 !== 0 ? [i + 1] : []);
        if (ids.length > 0) commands.push({ type: 'move', units: ids, x: gen.rand() / 682.66, y: gen.rand() / 682.66 });
      }
      if (commands.length > 0) batches.push({ turn, player, commands });
    }
  }
  return { players, randomSeed: 4242, units, turns, batches };
}
