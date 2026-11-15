import type { Command } from './commands';
import { CrtRand } from './rng';
import { TOOL_AGE } from './techs';
import { BARRACKS, BOWMAN, CLUBMAN, HOUSE, TOWN_CENTER, VILLAGER } from './units';
import { startingObjects, World, type SpeedChange, type StartUnit } from './world';

/** Everything needed to rerun a game: start state plus every batch, keyed by the turn it was issued on. */
export interface ReplayLog {
  players: number;
  randomSeed: number;
  /** Objects placed before the first step. */
  units?: StartUnit[];
  turns: number;
  batches: { turn: number; player: number; commands: Command[] }[];
  /** Step size and buffer frame changes, each given to the world on the turn it was agreed for (turn-timing.md §8.7). */
  speeds?: SpeedChange[];
}

/** Run a log from the start; returns the state hash after every turn. */
export function runReplay(
  log: ReplayLog,
  world = new World({ players: log.players, randomSeed: log.randomSeed, units: log.units }),
): number[] {
  const hashes: number[] = [];
  while (world.turn < log.turns) {
    for (const b of log.batches) if (b.turn === world.turn) world.addBatch(b.turn, b.player, b.commands);
    for (const c of log.speeds ?? []) if (c.turn === world.turn) world.setSpeedChange(c);
    world.runTurn();
    hashes.push(world.hash());
  }
  return hashes;
}

/**
 * `(G, F)` changes the sample replays, as the host would agree them (turn-timing.md §5, §7): from the defaults down
 * to small steps and back up, so every engine also runs 20, 30 and 150 ms steps.
 */
const SAMPLE_SPEEDS: readonly SpeedChange[] = [
  { turn: 24, granularity: 30, frames: 9 },
  { turn: 30, granularity: 20, frames: 13 },
  { turn: 36, granularity: 150, frames: 8 },
  { turn: 60, granularity: 90, frames: 10 },
];

/** Two Clubmen and a Bowman per player, facing each other across the middle of the test map, after the starting objects. */
const SKIRMISH: readonly StartUnit[] = [
  { owner: 1, type: CLUBMAN, x: 18.5, y: 18.5 },
  { owner: 1, type: CLUBMAN, x: 19.5, y: 18.5 },
  { owner: 1, type: BOWMAN, x: 18.5, y: 17.5 },
  { owner: 2, type: CLUBMAN, x: 21.5, y: 20.5 },
  { owner: 2, type: CLUBMAN, x: 22.5, y: 20.5 },
  { owner: 2, type: BOWMAN, x: 22.5, y: 21.5 },
];

/**
 * A fixed log for determinism tests: Gaia plus two players with the test map's starting objects (`startingObjects`)
 * (with `war`, also a skirmish of two Clubmen and a Bowman each in the middle of the map, close enough to find each other),
 * each issuing 0-3 `test` commands per turn at coordinates that are not exact float32 values, so every step exercises
 * float32 rounding. Now and then, spaced so gatherers fill up and drop off, builders finish and units train between
 * orders: a `move` of some of their Villagers (and sometimes one of the other side's, which is ignored) to a random
 * point of the map, water included; a `work` order, mostly on a resource near their base, else on a random starting
 * object (resources, either Town Center, the other side's units) or a missing one; a `build` of a House or Barracks near their Town Center (some spots are taken);
 * a `queue` of Villagers (or a Clubman, or an unqueue) at their Town Center or now and then the other's; with `war`, an `attack` by
 * some of their Villagers and of the units made during the game on one of the other side's Villagers, mostly, else its
 * Town Center or a unit made during the game (drawn from a second generator, so the other orders stay as they were);
 * rarely a `cancel` of an object made during the game; and, from a third generator, now and then a `research` at their
 * Town Center (sometimes the other's or an object made during the game) of a building's 2-second tech (Granary,
 * Storage Pit or Barracks built: two make the Tool Age available), the Tool Age or any tech id, and rarely a `stop` of
 * their Town Center. The step size and buffer frames change on the way (`SAMPLE_SPEEDS`). With `war`, 20 turns before
 * the end player 2 deletes every object it may own (a `cancel` of every id the game can have reached): it is defeated
 * at its next per-second check and player 1 wins (docs/spec/victory.md §6).
 */
export function sampleReplay(turns = 120, seed = 20260101, war = true): ReplayLog {
  const players = 3;
  const units = war ? [...startingObjects(players), ...SKIRMISH] : startingObjects(players);
  const gen = new CrtRand();
  gen.srand(seed);
  const fight = new CrtRand();
  fight.srand(seed + 7919);
  const study = new CrtRand();
  study.srand(seed + 104729);
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
      if (war && fight.rand() % 24 === 0) {
        const made = Array.from({ length: 1 + (fight.rand() % 6) }, () => units.length + 1 + (fight.rand() % 40));
        const ids = [...new Set([...villagers.filter((v) => v.owner === player && fight.rand() % 3 === 0).map((v) => v.id), ...made])];
        const enemies = villagers.filter((v) => v.owner !== player);
        const roll = fight.rand() % 8;
        const target =
          roll < 5 ? enemies[fight.rand() % enemies.length]!.id : roll < 6 ? centers.find((c) => c.owner !== player)!.id : units.length + 1 + (fight.rand() % 40);
        commands.push({ type: 'attack', units: ids, target });
      }
      if (gen.rand() % 60 === 0) commands.push({ type: 'cancel', target: units.length + 1 + (gen.rand() % 40) });
      if (study.rand() % 20 === 0) {
        const roll = study.rand() % 8;
        const building = roll < 6 ? own.id : roll < 7 ? centers.find((c) => c.owner !== player)!.id : units.length + 1 + (study.rand() % 40);
        const techs = [10, 39, 62, TOOL_AGE, TOOL_AGE, study.rand() % 130];
        commands.push({ type: 'research', building, tech: techs[study.rand() % techs.length]! });
      }
      if (study.rand() % 150 === 0) commands.push({ type: 'stop', objects: [own.id] });
      // Ids so far: the start objects, at most 3 probes per player per turn, and what the game made (well under 2 a turn).
      if (war && player === 2 && turn === turns - 20) {
        for (let id = 1; id <= units.length + 8 * turn; id++) commands.push({ type: 'cancel', target: id });
      }
      if (commands.length > 0) batches.push({ turn, player, commands });
    }
  }
  return { players, randomSeed: 4242, units, turns, batches, speeds: SAMPLE_SPEEDS.filter((c) => c.turn < turns).map((c) => ({ ...c })) };
}
