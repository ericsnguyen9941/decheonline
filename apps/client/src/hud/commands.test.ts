import { expect, test } from 'vitest';
import { BARRACKS, BUILDER, CLUBMAN, GRANARY, HOUSE, startingObjects, STORAGE_PIT, TOWN_CENTER, unitType, VILLAGER, World } from '@aoe/sim';
import { buttonSlot, bySlot, canBuild, commandButtons, constructionProgress, itemsMadeAt, trainingStatus, type CommandContext } from './commands';

// `button_location` of these masters in data2/empires.dat (npm run dat:dump -- unit <id>).
const BUTTONS: Record<number, number> = { [HOUSE]: 1, [BARRACKS]: 2, [GRANARY]: 3, [STORAGE_PIT]: 4, [TOWN_CENTER]: 14, [VILLAGER]: 1, [CLUBMAN]: 1 };

function game(): { world: World; context: (id: number, mode?: CommandContext['mode']) => CommandContext } {
  const world = new World({ players: 3, units: startingObjects(3) });
  const context = (id: number, mode: CommandContext['mode'] = 'normal') => ({
    world,
    player: 1,
    object: world.entities.get(id),
    mode,
    page: 0,
    buttonOf: (unit: number) => BUTTONS[unit] ?? null,
  });
  return { world, context };
}

const own = (world: World, type: number) => [...world.entities.ofPlayer(1)].find((e) => e.type === type)!;

test('calc_button_loc maps both pages onto the 2x6 grid', () => {
  expect([1, 5, 6, 10, 11, 15, 16, 20, 0].map(buttonSlot)).toEqual([0, 4, 6, 10, 0, 4, 6, 10, 0]);
});

test('villager-class units build, others do not', () => {
  expect(canBuild(unitType(VILLAGER))).toBe(true);
  expect(canBuild(unitType(BUILDER))).toBe(true);
  expect(canBuild(unitType(CLUBMAN))).toBe(false);
});

test('a villager gets Build and Unselect; its build menu the start buildings at their dat slots and Cancel', () => {
  const { world, context } = game();
  const villager = own(world, VILLAGER);
  expect(commandButtons(context(villager.id))).toEqual([
    { kind: 'build', slot: 0 },
    { kind: 'unselect', slot: 11 },
  ]);
  // Stone Age start techs enable the House, Barracks, Granary and Storage Pit; the Town Center needs a player with none.
  expect(itemsMadeAt(world, 1, BUILDER)).toEqual([BARRACKS, GRANARY, HOUSE, STORAGE_PIT]);
  const slots = bySlot(commandButtons(context(villager.id, 'build-menu')));
  expect(slots.map((b) => (b && 'unit' in b ? b.unit : b?.kind))).toEqual([
    HOUSE,
    BARRACKS,
    GRANARY,
    STORAGE_PIT,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    'cancel',
  ]);
  expect(commandButtons(context(villager.id, 'place'))).toEqual([{ kind: 'cancel', slot: 11 }]);
});

test("a Town Center trains villagers; with a queue only the queued unit shows, with its count", () => {
  const { world, context } = game();
  const tc = own(world, TOWN_CENTER);
  expect(commandButtons(context(tc.id))).toEqual([
    { kind: 'train', slot: 0, unit: VILLAGER, count: 0 },
    { kind: 'unselect', slot: 11 },
  ]);
  world.addBatch(world.turn, 1, [{ type: 'queue', building: tc.id, unit: VILLAGER, count: 2 }]);
  while (tc.queue!.length === 0) world.runTurn();
  expect(commandButtons(context(tc.id))[0]).toEqual({ kind: 'train', slot: 0, unit: VILLAGER, count: 2 });
  while (!tc.train || tc.train.workDone === 0) world.runTurn();
  const status = trainingStatus(tc)!;
  expect(status.unit).toBe(VILLAGER);
  expect(status.progress).toBe(Math.trunc((tc.train.workDone * 100) / unitType(VILLAGER).creatable!.trainTime));
});

test("another player's object only gets Unselect; a foundation gets Cancel Construction and shows its progress", () => {
  const { world, context } = game();
  const theirs = [...world.entities.ofPlayer(2)].find((e) => e.type === TOWN_CENTER)!;
  expect(commandButtons(context(theirs.id))).toEqual([{ kind: 'unselect', slot: 11 }]);
  const villager = own(world, VILLAGER);
  world.addBatch(world.turn, 1, [{ type: 'build', units: [villager.id], unitType: HOUSE, x: 15, y: 9 }]);
  let house = own(world, HOUSE);
  while (!house) {
    world.runTurn();
    house = own(world, HOUSE);
  }
  expect(constructionProgress(house)).toBe(0);
  expect(commandButtons(context(house.id))).toEqual([
    { kind: 'cancel-construction', slot: 0 },
    { kind: 'unselect', slot: 11 },
  ]);
  house.buildPoints = 7;
  expect(constructionProgress(house)).toBe(35);
});

test('without the dat button locations the list order fills the grid', () => {
  const { world, context } = game();
  const villager = own(world, VILLAGER);
  const c = { ...context(villager.id, 'build-menu'), buttonOf: () => null };
  expect(commandButtons(c).map((b) => b.slot)).toEqual([0, 1, 2, 3, 11]);
});

test('several selected units get Group and Ungroup; one in a group Ungroup alone; mixed levels Build and Cancel', () => {
  const { world, context } = game();
  const villagers = [...world.entities.ofPlayer(1)].filter((e) => e.type === VILLAGER);
  const levelOf = (unit: number) => (unit === VILLAGER ? 3 : unit === CLUBMAN ? 4 : unit === TOWN_CENTER ? 2 : null);
  const c = { ...context(villagers[0]!.id), selected: villagers, levelOf };
  expect(commandButtons(c)).toEqual([
    { kind: 'build', slot: 0 },
    { kind: 'group', slot: 6 },
    { kind: 'ungroup', slot: 7 },
    { kind: 'unselect', slot: 11 },
  ]);
  expect(commandButtons({ ...c, selected: [villagers[0]!], grouped: true })).toEqual([
    { kind: 'build', slot: 0 },
    { kind: 'ungroup', slot: 6 },
    { kind: 'unselect', slot: 11 },
  ]);
  // A Villager with the Town Center: levels differ (0), so the special selection's buttons, ending in Cancel.
  const tc = own(world, TOWN_CENTER);
  expect(commandButtons({ ...c, selected: [villagers[0]!, tc] })).toEqual([
    { kind: 'build', slot: 0 },
    { kind: 'group', slot: 6 },
    { kind: 'ungroup', slot: 7 },
    { kind: 'cancel', slot: 11 },
  ]);
});
