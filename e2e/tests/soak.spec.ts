import { expect, test, type Browser, type Page } from '@playwright/test';
import { ARCHERY_RANGE, BARRACKS, BOWMAN, BUILDER, CLUBMAN, FARM, FORAGE, FORAGER, GAZELLE, GRANARY, HOUSE, HUNTER, LUMBERJACK, MARKET, MINE_GOLD, MINE_STONE, MINER_GOLD, MINER_STONE, SCOUT, SLINGER, STABLE, STORAGE_PIT, TOWN_CENTER, TREES, VILLAGER } from '@aoe/sim';

// Soak: two clients join by invite code, play a random Hill Country map and both issue a steady stream of varied commands
// for SOAK_MINUTES of game time (default 20); the run fails on the first desync, with the turn and both hashes. Manual
// project (`npm run test:soak`), never part of `test:e2e`. The first test checks the detector itself: a client that
// changes its own state after one turn must be reported at the next.
//
// A game that ends cleanly (conquest) before the minutes are up is not a failure: both clients leave it and play a new
// game (new invite code, next derived map and command seed, printed) until the summed game time reaches SOAK_MINUTES.
//
// Env: SOAK_MINUTES game minutes; SOAK_SEED the first game's map seed (default random, printed; both clients play it);
// SOAK_BOT_SEED its commands' seed (default derived from the map seed). A failing run is replayed with the two seeds
// printed for the game that failed.
const MINUTES = Number(process.env['SOAK_MINUTES'] ?? 20);
const MAP_SEED = process.env['SOAK_SEED'] !== undefined ? Number(process.env['SOAK_SEED']) : Math.floor(Math.random() * 0x7fffffff);
const BOT_SEED = process.env['SOAK_BOT_SEED'] !== undefined ? Number(process.env['SOAK_BOT_SEED']) : MAP_SEED ^ 0x5bd1e995;
/** Turns between two rounds of commands (a turn is about a second of game time). */
const ROUND_TURNS = 2;
/** A turn that does not come within this long is a stall, not a slow machine (frames take 70-300 ms on a loaded one). */
const STALL_MS = 180_000;

// speed=20 runs the lockstep clock 20x faster; resources=20000 pays for what the bot builds, trains and researches;
// bowmen=6 gives every player soldiers to attack with before it has an Archery Range or Barracks; market=1 gives every player a built Market (its tech enables the Farm). Both clients ask for the same.
const url = (seed: number, extra: string) => `/?debug=net&speed=20&resources=20000&bowmen=6&market=1&seed=${seed}${extra}`;
/** Game `n`'s map seed: the first game's is SOAK_SEED, the next ones step by the golden-ratio constant. */
const mapSeedOf = (n: number) => (MAP_SEED + Math.imul(n, 0x9e3779b1)) & 0x7fffffff;
/** Game `n`'s command seed: SOAK_BOT_SEED for the first game, else derived from that game's map seed. */
const botSeedOf = (n: number) => (n === 0 ? BOT_SEED : mapSeedOf(n) ^ 0x5bd1e995);
/** More games than this means games end at once, not early. */
const MAX_GAMES = 60;

const VILLAGERS: number[] = [VILLAGER, BUILDER, FORAGER, LUMBERJACK, HUNTER, MINER_STONE, MINER_GOLD, 259 /* Farmer */, 156 /* Repairman */];
const MILITARY: number[] = [CLUBMAN, BOWMAN, SCOUT, SLINGER];
const RESOURCES: number[] = [...TREES, FORAGE, MINE_GOLD, MINE_STONE, GAZELLE];
/** What each building trains (master ids). */
const TRAINS: Record<number, number[]> = { [TOWN_CENTER]: [VILLAGER], [BARRACKS]: [CLUBMAN], [ARCHERY_RANGE]: [BOWMAN], [STABLE]: [SCOUT] };
const BUILDINGS = [HOUSE, HOUSE, HOUSE, FARM, FARM, FARM, BARRACKS, GRANARY, STORAGE_PIT, ARCHERY_RANGE, STABLE, MARKET];
const TECH_COUNT = 127;

async function open(browser: Browser, seed: number, extra = ''): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 800, height: 600 } })).newPage();
  await page.goto(url(seed, extra));
  return page;
}

/** Host creates, guest joins by code, both ready (host with `civs`), host starts; resolves once both have drawn the map. */
async function startGame(browser: Browser, setup: { civs: [number, number]; seed?: number; guestExtra?: string; hostExtra?: string; lobby?: boolean }): Promise<[Page, Page]> {
  const host = await open(browser, setup.seed ?? MAP_SEED, setup.hostExtra);
  const guest = await open(browser, setup.seed ?? MAP_SEED, setup.guestExtra);
  await host.getByTestId('name').fill('Alice');
  await host.getByTestId('create').click();
  const code = (await host.getByTestId('invite-code').textContent())!;
  await guest.getByTestId('name').fill('Bob');
  await guest.getByTestId('code').fill(code);
  await guest.getByTestId('join').click();
  await expect(host.getByTestId('player-1')).toContainText('Bob');
  if (setup.lobby) {
    await host.getByTestId('map-size').selectOption('120');
    await host.getByTestId('map-type').selectOption({ label: 'Hill Country' });
    // Score 3000: the game goes on for the whole run, whatever the bot kills.
    await host.getByTestId('victory').selectOption({ label: 'Score' });
    await host.getByTestId('victory-amount').selectOption('3000');
  }
  await host.getByTestId('civ-0').selectOption(String(setup.civs[0]));
  await guest.getByTestId('civ-1').selectOption(String(setup.civs[1]));
  await host.getByTestId('ready').click();
  await guest.getByTestId('ready').click();
  await expect(host.getByTestId('start')).toBeEnabled();
  await host.getByTestId('start').click();
  for (const page of [host, guest]) await page.waitForFunction(() => window.__game?.selection() != null && window.__map !== undefined);
  return [host, guest];
}

const hex = (h: number | undefined) => (h === undefined ? 'none' : h.toString(16).padStart(8, '0'));
const turnOf = (page: Page) => page.evaluate(() => window.__game!.turn());

/** The failure message of a desync the relay reported; null while both games agree. */
async function desyncMessage(host: Page, guest: Page): Promise<string | null> {
  for (const page of [host, guest]) {
    const d = await page.evaluate(() => window.__game!.desync());
    if (d) return `desync at turn ${d.turn}: host hash ${hex(d.hashes[0])}, guest hash ${hex(d.hashes[1])}`;
  }
  return null;
}

/** Each client's own hash of `turn`, compared by the test itself in case the relay's report is ever lost. */
async function hashesAt(host: Page, guest: Page, turn: number): Promise<[number | undefined, number | undefined]> {
  const read = (page: Page) => page.evaluate((t) => window.__game!.hash(t), turn);
  return [await read(host), await read(guest)];
}

test('a client whose state differs after one turn is reported as a desync naming the turn', async ({ browser }) => {
  const PERTURB = 30;
  const [host, guest] = await startGame(browser, { civs: [1, 1], guestExtra: `&perturb=${PERTURB}` });
  await host.waitForFunction(() => window.__game!.desync() !== null, undefined, { timeout: STALL_MS });
  const message = await desyncMessage(host, guest);
  console.log(`forced desync caught: ${message}`);
  // The guest changed its food after turn 30, so the games differ from turn 31; the sync check runs on every 4th turn
  // (turn-timing.md §9.1), so the relay reports the first of them: turn 32, at most 3 turns after the change.
  const checked = Math.ceil((PERTURB + 1) / 4) * 4;
  expect(message).toMatch(new RegExp(`^desync at turn ${checked}: host hash [0-9a-f]{8}, guest hash [0-9a-f]{8}$`));
  const [h, g] = await hashesAt(host, guest, checked);
  expect(h).not.toBe(g);
});

// 20 game minutes are about 1200 turns: a minute of wall time at speed 20 on an idle machine, many more on a loaded one.
test.setTimeout(3_600_000);

interface Snapshot {
  me: number;
  turn: number;
  units: { id: number; type: number; x: number; y: number }[];
  buildings: { id: number; type: number; x: number; y: number; complete: boolean }[];
  food: number;
  headroom: number;
}

/** Splitmix-style seeded generator: the bot's choices repeat for one seed. */
function rng(seed: number) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s ^ (s >>> 16);
    z = Math.imul(z, 0x21f0aaad) >>> 0;
    z ^= z >>> 15;
    z = Math.imul(z, 0x735a2d97) >>> 0;
    return ((z ^ (z >>> 15)) >>> 0) / 0x100000000;
  };
  return {
    next,
    int: (n: number) => Math.floor(next() * n),
    pick: <T>(a: readonly T[]): T => a[Math.floor(next() * a.length)]!,
    chance: (p: number) => next() < p,
  };
}

/** One player's command stream: reads its own page's world and issues orders through `window.__game.issue`. */
class Bot {
  readonly issued = new Map<string, number>();
  private readonly r: ReturnType<typeof rng>;
  private resources: { id: number; x: number; y: number }[] = [];
  private enemies: { id: number; x: number; y: number }[] = [];
  private hills: [number, number][] = [];
  private size = 0;
  private rounds = 0;

  constructor(
    private readonly page: Page,
    seed: number,
  ) {
    this.r = rng(seed);
  }

  /** The map's raised tiles and size (identical on both clients), once. */
  async prepare(): Promise<void> {
    const map = await this.page.evaluate(() => {
      const m = window.__map!;
      const hills: [number, number][] = [];
      for (let r = 0; r < m.height; r += 2) for (let c = 0; c < m.width; c += 2) if (m.tileInfo(c, r).height > 0) hills.push([c, r]);
      return { width: m.width, hills };
    });
    this.size = map.width;
    this.hills = map.hills;
  }

  private async look(): Promise<Snapshot> {
    // Gaia's gatherables and the enemy's objects change slowly: refreshed every 10 rounds (a stale target is a fine command).
    const refresh = this.rounds++ % 10 === 0;
    const s = await this.page.evaluate(
      ([resourceTypes, refreshObjects]) => {
        const g = window.__game!;
        const me = g.player();
        const units = g.units().filter((u) => u.owner === me).map((u) => ({ id: u.id, type: u.type, x: u.x, y: u.y }));
        const buildings = g.buildings().filter((b) => b.owner === me).map((b) => ({ id: b.id, type: b.type, x: b.x, y: b.y, complete: b.progress >= 100 }));
        const objects = refreshObjects ? g.objects() : [];
        const resources = objects.filter((o) => o.owner === 0 && resourceTypes!.includes(o.type)).map((o) => ({ id: o.id, x: o.x, y: o.y }));
        const enemies = objects.filter((o) => o.owner !== 0 && o.owner !== me).map((o) => ({ id: o.id, x: o.x, y: o.y }));
        return { me, turn: g.turn(), units, buildings, food: g.resources(me).food, headroom: g.population(me).headroom, resources, enemies, refreshObjects };
      },
      [RESOURCES, refresh] as const,
    );
    if (s.refreshObjects) {
      this.resources = s.resources;
      this.enemies = s.enemies;
    }
    return s;
  }

  private issue(command: { type: string; [field: string]: unknown }): Promise<void> {
    this.issued.set(command.type, (this.issued.get(command.type) ?? 0) + 1);
    return this.page.evaluate((c) => window.__game!.issue(c), command);
  }

  private nearest<T extends { x: number; y: number }>(list: T[], x: number, y: number, among = 8): T | undefined {
    const sorted = [...list].sort((a, b) => (a.x - x) ** 2 + (a.y - y) ** 2 - ((b.x - x) ** 2 + (b.y - y) ** 2));
    return sorted.length > 0 ? this.r.pick(sorted.slice(0, among)) : undefined;
  }

  private some<T>(list: T[], most: number): T[] {
    const copy = [...list];
    const out: T[] = [];
    for (let n = 1 + this.r.int(most); n > 0 && copy.length > 0; n--) out.push(copy.splice(this.r.int(copy.length), 1)[0]!);
    return out;
  }

  /** One round: a few orders of different kinds from this player's current world. */
  async round(): Promise<void> {
    const s = await this.look();
    const villagers = s.units.filter((u) => VILLAGERS.includes(u.type));
    const military = s.units.filter((u) => MILITARY.includes(u.type));
    const centre = s.buildings.find((b) => b.type === TOWN_CENTER) ?? s.buildings[0] ?? villagers[0];
    for (let n = 2 + this.r.int(3); n > 0; n--) {
      const roll = this.r.next();
      if (roll < 0.25 && villagers.length > 0) {
        // Gather: a few villagers to a tree, berry bush, mine or gazelle near the first one.
        const group = this.some(villagers, 4);
        const target = this.nearest(this.resources, group[0]!.x, group[0]!.y);
        if (target) await this.issue({ type: 'work', units: group.map((u) => u.id), target: target.id, x: target.x, y: target.y });
      } else if (roll < 0.42 && villagers.length > 0 && centre) {
        // Build: a house when the population is near its limit, else any building, at a tile round the Town Center.
        const unitType = s.headroom < 3 && this.r.chance(0.7) ? HOUSE : this.r.pick(BUILDINGS);
        const x = Math.round(centre.x) + this.r.int(25) - 12;
        const y = Math.round(centre.y) + this.r.int(25) - 12;
        await this.issue({ type: 'build', units: this.some(villagers, 2).map((u) => u.id), unitType, x, y });
      } else if (roll < 0.62) {
        // Train, or take a queued unit back out.
        const building = this.r.pick(s.buildings.filter((b) => b.type in TRAINS));
        if (building) {
          const count = this.r.chance(0.1) ? -1 : 1 + this.r.int(3);
          await this.issue({ type: 'queue', building: building.id, unit: this.r.pick(TRAINS[building.type]!), count });
        }
      } else if (roll < 0.74 && s.units.length > 0) {
        // Move: anywhere on the map, or onto a hill.
        const group = this.some(s.units, 6);
        const [x, y] = this.hills.length > 0 && this.r.chance(0.35) ? this.r.pick(this.hills) : [this.r.int(this.size), this.r.int(this.size)];
        await this.issue({ type: 'move', units: group.map((u) => u.id), x: x + 0.5, y: y + 0.5 });
      } else if (roll < 0.83 && military.length > 0) {
        // Attack: soldiers at one of the enemy's objects.
        const group = this.some(military, 5);
        const target = this.nearest(this.enemies, group[0]!.x, group[0]!.y, 12);
        if (target) await this.issue({ type: 'attack', units: group.map((u) => u.id), target: target.id });
      } else if (roll < 0.9 && s.buildings.length > 0) {
        // Research: any tech at any building; the sim refuses what the building cannot research.
        await this.issue({ type: 'research', building: this.r.pick(s.buildings).id, tech: this.r.int(TECH_COUNT) });
      } else if (roll < 0.94 && villagers.length > 0 && s.buildings.length > 0) {
        await this.issue({ type: 'repair', units: this.some(villagers, 3).map((u) => u.id), target: this.r.pick(s.buildings).id });
      } else if (roll < 0.97 && s.units.length > 0) {
        const ids = this.some(s.units, 4).map((u) => u.id);
        await this.issue(this.r.chance(0.5) ? { type: 'stop', objects: ids } : { type: 'stand-ground', units: ids });
      } else if (s.buildings.length > 0) {
        await this.issue({ type: 'cancel', target: this.r.pick(s.buildings).id });
      }
    }
  }
}

interface GameReport {
  turn: number;
  /** Game time of the world (it stops when the game ends), ms. */
  timeMs: number;
  /** The result when the game ended before its time was up, else null. */
  ended: string | null;
  hashes: [number | undefined, number | undefined];
}

/** One game between two fresh clients for `limitMs` of game time or until it ends; a desync throws. */
async function playGame(browser: Browser, n: number, limitMs: number, issued: Map<string, number>): Promise<GameReport> {
  const rand = rng(botSeedOf(n) ^ 0x1234);
  const civs: [number, number] = [1 + rand.int(16), 1 + rand.int(16)];
  console.log(`soak: game ${n + 1}: map seed ${mapSeedOf(n)} (SOAK_SEED), command seed ${botSeedOf(n)} (SOAK_BOT_SEED), civs ${civs.join(' and ')}, up to ${Math.round(limitMs / 1000)} s`);
  const [host, guest] = await startGame(browser, { civs, seed: mapSeedOf(n), lobby: true });
  const pages = [host, guest];
  try {
    const bots = [new Bot(host, botSeedOf(n)), new Bot(guest, botSeedOf(n) + 1)];
    for (const bot of bots) await bot.prepare();

    let turn = await turnOf(host);
    let rounds = 0;
    let ended: string | null = null;
    const wallStart = Date.now();
    for (;;) {
      // Wait on state: the next round's turn on both clients. Wall time is not a cap; a stalled game is.
      turn += ROUND_TURNS;
      for (const page of pages) await page.waitForFunction((t) => window.__game!.turn() >= t, turn, { timeout: STALL_MS });
      const failure = await desyncMessage(host, guest);
      if (failure) throw new Error(failure);
      const [time, result] = await host.evaluate(() => [window.__game!.gameTime(), window.__game!.gameResult()] as const);
      if (result) {
        const scores = await host.evaluate(() => [1, 2].map((p) => window.__game!.score(p).total));
        ended = `${JSON.stringify(result)}, scores ${scores.join(' and ')}`;
        break;
      }
      if (time >= limitMs) break;
      for (const bot of bots) await bot.round();
      if (++rounds % 25 === 0) console.log(`soak: game ${n + 1}: turn ${turn}, game time ${Math.round(time / 1000)} s, wall ${Math.round((Date.now() - wallStart) / 1000)} s`);
    }

    // Both clients past the host's last turn, then the same turn's hash from each, compared here and by the relay.
    const last = await turnOf(host);
    await guest.waitForFunction((t) => window.__game!.turn() > t + 2, last, { timeout: STALL_MS });
    await host.waitForFunction((t) => window.__game!.turn() > t + 2, last, { timeout: STALL_MS });
    const failure = await desyncMessage(host, guest);
    if (failure) throw new Error(failure);
    const checked = Math.floor(last / 4) * 4; // the clients keep a checksum for every 4th turn
    const [h, g] = await hashesAt(host, guest, checked);
    if (h !== g) throw new Error(`desync at turn ${checked}: host hash ${hex(h)}, guest hash ${hex(g)} (the relay reported nothing)`);

    const summary = await Promise.all(
      pages.map((page) =>
        page.evaluate(() => {
          const g = window.__game!;
          const mine = (p: number) => g.units().filter((u) => u.owner === p).length;
          const built = (p: number) => g.buildings().filter((b) => b.owner === p).length;
          const soldiers = (p: number) => g.units().filter((u) => u.owner === p && [73, 4, 299, 347].includes(u.type)).length;
          return [1, 2].map((p) => `player ${p}: ${mine(p)} units (${soldiers(p)} soldiers), ${built(p)} buildings, age ${g.age(p)}, food ${Math.floor(g.resources(p).food)}`);
        }),
      ),
    );
    expect(summary[0]).toEqual(summary[1]);
    const time = await host.evaluate(() => window.__game!.gameTime());
    for (const [i, bot] of bots.entries()) {
      console.log(`soak: game ${n + 1}: ${i === 0 ? 'host' : 'guest'} issued ${[...bot.issued].map(([k, v]) => `${v} ${k}`).join(', ')}`);
      for (const [k, v] of bot.issued) issued.set(k, (issued.get(k) ?? 0) + v);
    }
    console.log(`soak: game ${n + 1}: ${summary[0]!.join('; ')}`);
    return { turn: checked, timeMs: time, ended, hashes: [h, g] };
  } finally {
    for (const page of pages) await page.context().close();
  }
}

test(`two clients play ${MINUTES} minutes of game time by invite code without a desync`, async ({ browser }) => {
  console.log(`soak: first map seed ${MAP_SEED} (SOAK_SEED), first command seed ${BOT_SEED} (SOAK_BOT_SEED), ${MINUTES} min of game time in total`);
  const endMs = MINUTES * 60_000;
  const issued = new Map<string, number>();
  let total = 0;
  let games = 0;
  while (total < endMs) {
    if (games >= MAX_GAMES) throw new Error(`${MAX_GAMES} games ended and the summed game time is only ${Math.round(total / 1000)} s of ${MINUTES * 60} s`);
    const report = await playGame(browser, games, endMs - total, issued);
    total += report.timeMs;
    const [h, g] = report.hashes;
    console.log(
      `soak: game ${games + 1} ${report.ended ? `ended early (${report.ended})` : 'reached its time'}: map seed ${mapSeedOf(games)}, command seeds ${botSeedOf(games)} and ${botSeedOf(games) + 1}, ` +
        `turn ${report.turn}, game time ${Math.round(report.timeMs / 1000)} s, hash of turn ${report.turn}: host ${hex(h)}, guest ${hex(g)}; summed game time ${Math.round(total / 1000)} s of ${MINUTES * 60} s`,
    );
    games++;
  }
  console.log(`soak: passed, ${games} game${games === 1 ? '' : 's'}, summed game time ${Math.round(total / 1000)} s, no desync`);
  for (const kind of ['work', 'build', 'queue', 'move', 'attack', 'research']) expect(issued.get(kind) ?? 0, `${kind} commands issued`).toBeGreaterThan(0);
});
