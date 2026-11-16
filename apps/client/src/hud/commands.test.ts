import { expect, test } from 'vitest';
import { BARRACKS, BUILDER, checkPlacement, CLUBMAN, GRANARY, HOUSE, master, ObjectState, startingObjects, STORAGE_PIT, TECH_DISABLED, TOOL_AGE, TOWN_CENTER, unitType, VILLAGER, World, type Entity } from '@aoe/sim';
import { buttonSlot, bySlot, canBuild, commandButtons, constructionProgress, itemsMadeAt, researchStatus, techsAt, trainingStatus, type CommandContext } from './commands';

// Archery Range, Stable, Bowman, Scout; 45 is the Dock.
const RANGE = 87;
const STABLE = 101;
const BOWMAN = 4;
const SCOUT = 299;
// `button_location` of these masters in data2/empires.dat (npm run dat:dump -- unit <id>).
const BUTTONS: Record<number, number> = { [HOUSE]: 1, [BARRACKS]: 2, [GRANARY]: 3, [STORAGE_PIT]: 4, 45: 5, [TOWN_CENTER]: 14, [VILLAGER]: 1, [CLUBMAN]: 1, [RANGE]: 6, [STABLE]: 7, [BOWMAN]: 1, [SCOUT]: 1 };
// and of the Tool Age (npm run dat:dump -- tech 101).
const TECH_BUTTONS: Record<number, number> = { [TOOL_AGE]: 6 };

function game(): { world: World; context: (id: number, mode?: CommandContext['mode']) => CommandContext } {
  const world = new World({ players: 3, units: startingObjects(3) });
  const context = (id: number, mode: CommandContext['mode'] = 'normal') => ({
    world,
    player: 1,
    object: world.entities.get(id),
    mode,
    page: 0,
    buttonOf: (unit: number) => BUTTONS[unit] ?? null,
    techButtonOf: (tech: number) => TECH_BUTTONS[tech] ?? null,
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

test('a villager gets Build, Repair and Unselect; its build menu the start buildings at their dat slots and Cancel', () => {
  const { world, context } = game();
  const villager = own(world, VILLAGER);
  expect(commandButtons(context(villager.id))).toEqual([
    { kind: 'build', slot: 0 },
    { kind: 'repair', slot: 1 },
    { kind: 'unselect', slot: 11 },
  ]);
  // Stone Age start techs enable the House, Barracks, Dock (45), Granary and Storage Pit; the Town Center needs a player with none.
  expect(itemsMadeAt(world, 1, BUILDER)).toEqual([BARRACKS, 45, GRANARY, HOUSE, STORAGE_PIT]);
  const slots = bySlot(commandButtons(context(villager.id, 'build-menu')));
  expect(slots.map((b) => (b && 'unit' in b ? b.unit : b?.kind))).toEqual([
    HOUSE,
    BARRACKS,
    GRANARY,
    STORAGE_PIT,
    45,
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

test("a Town Center trains villagers and shows the Tool Age disabled; with a queue only the queued unit and Stop", () => {
  const { world, context } = game();
  const tc = own(world, TOWN_CENTER);
  expect(commandButtons(context(tc.id))).toEqual([
    { kind: 'train', slot: 0, unit: VILLAGER, count: 0 },
    { kind: 'research', slot: 6, tech: TOOL_AGE, disabled: true },
    { kind: 'unselect', slot: 11 },
  ]);
  world.addBatch(world.turn, 1, [{ type: 'queue', building: tc.id, unit: VILLAGER, count: 2 }]);
  while (tc.queue!.length === 0) world.runTurn();
  expect(commandButtons(context(tc.id))).toEqual([
    { kind: 'stop', slot: 6 },
    { kind: 'train', slot: 0, unit: VILLAGER, count: 2 },
    { kind: 'unselect', slot: 11 },
  ]);
  while (!tc.train || tc.train.workDone === 0) world.runTurn();
  const status = trainingStatus(world, tc)!;
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
  expect(constructionProgress(world, house)).toBe(0);
  expect(commandButtons(context(house.id))).toEqual([
    { kind: 'cancel-construction', slot: 0 },
    { kind: 'unselect', slot: 11 },
  ]);
  house.buildPoints = 7;
  expect(constructionProgress(world, house)).toBe(35);
});

test('without the dat button locations the list order fills the grid', () => {
  const { world, context } = game();
  const villager = own(world, VILLAGER);
  const c = { ...context(villager.id, 'build-menu'), buttonOf: () => null };
  expect(commandButtons(c).map((b) => b.slot)).toEqual([0, 1, 2, 3, 4, 11]);
});

test('several selected units get Group and Ungroup; one in a group Ungroup alone; mixed levels Build and Cancel', () => {
  const { world, context } = game();
  const villagers = [...world.entities.ofPlayer(1)].filter((e) => e.type === VILLAGER);
  const levelOf = (unit: number) => (unit === VILLAGER ? 3 : unit === CLUBMAN ? 4 : unit === TOWN_CENTER ? 2 : null);
  const c = { ...context(villagers[0]!.id), selected: villagers, levelOf };
  expect(commandButtons(c)).toEqual([
    { kind: 'build', slot: 0 },
    { kind: 'repair', slot: 1 },
    { kind: 'group', slot: 6 },
    { kind: 'ungroup', slot: 7 },
    { kind: 'unselect', slot: 11 },
  ]);
  expect(commandButtons({ ...c, selected: [villagers[0]!], grouped: true })).toEqual([
    { kind: 'build', slot: 0 },
    { kind: 'repair', slot: 1 },
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

/** Player 1's villagers build `type` on the first free spot around the Town Center; returns it once finished. */
function finished(world: World, type: number) {
  const tc = own(world, TOWN_CENTER);
  const ctx = world.gameContext();
  const t = master(world, 1, type);
  let at: [number, number] | undefined;
  for (let r = 3; !at && r < 12; r++)
    for (let d = -r; !at && d <= r; d++)
      for (const [dx, dy] of [[d, -r], [d, r], [-r, d], [r, d]] as const)
        if (!at && checkPlacement(ctx, t, tc.x + dx, tc.y + dy, true, true) === 0) at = [tc.x + dx, tc.y + dy];
  const villagers = [...world.entities.ofPlayer(1)].filter((e) => e.type === VILLAGER || e.type === BUILDER).map((e) => e.id);
  world.addBatch(world.turn, 1, [{ type: 'build', units: villagers, unitType: type, x: at![0], y: at![1] }]);
  let b: Entity | undefined;
  for (let i = 0; i < 2000 && b?.state !== ObjectState.Active; i++) {
    world.runTurn();
    b = [...world.entities.ofPlayer(1)].find((e) => e.type === type);
  }
  expect(b?.state).toBe(ObjectState.Active);
  return b!;
}

test('the Tool Age at the Town Center: available after two Stone Age buildings, researching shows Stop alone and the progress', () => {
  const { world, context } = game();
  const tc = own(world, TOWN_CENTER);
  world.attributes[1]![0] = 1000;
  world.attributes[1]![1] = 1000;
  finished(world, BARRACKS);
  finished(world, GRANARY);
  expect(techsAt(world, 1, TOWN_CENTER)).toEqual([TOOL_AGE]);
  expect(commandButtons(context(tc.id))).toContainEqual({ kind: 'research', slot: 6, tech: TOOL_AGE, disabled: false });
  world.addBatch(world.turn, 1, [{ type: 'research', building: tc.id, tech: TOOL_AGE }]);
  while (!tc.research) world.runTurn();
  world.runTurn();
  expect(commandButtons(context(tc.id))).toEqual([
    { kind: 'stop', slot: 0 },
    { kind: 'unselect', slot: 11 },
  ]);
  const status = researchStatus(world, tc)!;
  expect(status.tech).toBe(TOOL_AGE);
  expect(status.progress).toBe(Math.trunc((world.researchDone[1]![TOOL_AGE]! * 100) / 120));
  expect(status.progress).toBeGreaterThan(0);
  while (world.attributes[1]![6] !== 2) world.runTurn();
  // Tool Age: the villager's build menu holds the Archery Range and the Stable; no next age while the Bronze Age is locked.
  expect(itemsMadeAt(world, 1, BUILDER)).toEqual(expect.arrayContaining([RANGE, STABLE]));
  world.techs[1]![102] = TECH_DISABLED;
  expect(commandButtons(context(tc.id)).some((b) => b.kind === 'research')).toBe(false);
});

// Stone Thrower, Ballista, Priest (empires.dat). Their `unit_level` is 4, 4 and 6 (`interfaceKind`; guessed without a pack).
const STONE_THROWER = 35;
const BALLISTA = 11;
const PRIEST = 125;

/** A world of Gaia and two players with these units of player 1; ids from 1 in list order. */
function unitsGame(types: number[]): { world: World; context: (id: number, mode?: CommandContext['mode']) => CommandContext } {
  const world = new World({ players: 3, units: types.map((type, i) => ({ owner: 1, type, x: 10.5 + i, y: 10.5 })) });
  const context = (id: number, mode: CommandContext['mode'] = 'normal') => ({
    world,
    player: 1,
    object: world.entities.get(id),
    selected: [...world.entities.ofPlayer(1)],
    mode,
    page: 0,
    buttonOf: () => null,
  });
  return { world, context };
}

test('a Stone Thrower gets Attack Ground in slot 1 (Stop in 2); with a Ballista, whose missile has no area effect, it does not', () => {
  const thrower = unitsGame([STONE_THROWER]);
  expect(commandButtons(thrower.context(1))).toEqual([
    { kind: 'stand-ground', slot: 0 },
    { kind: 'attack-ground', slot: 1 },
    { kind: 'unselect', slot: 11 },
  ]);
  thrower.world.addBatch(thrower.world.turn, 1, [{ type: 'move', units: [1], x: 20, y: 20 }]);
  for (let i = 0; i < 40; i++) thrower.world.runStep();
  expect(commandButtons(thrower.context(1)).find((b) => b.kind === 'stop')).toEqual({ kind: 'stop', slot: 2 });
  const mixed = unitsGame([STONE_THROWER, BALLISTA]);
  expect(commandButtons(mixed.context(1)).map((b) => b.kind)).toEqual(['stand-ground', 'group', 'ungroup', 'unselect']);
});

test('a Priest gets Heal in slot 0 and Convert in slot 1', () => {
  const { context } = unitsGame([PRIEST]);
  expect(commandButtons(context(1))).toEqual([
    { kind: 'heal', slot: 0 },
    { kind: 'convert', slot: 1 },
    { kind: 'unselect', slot: 11 },
  ]);
});

test('an order mode (repair, attack ground, heal, convert, move) leaves only Cancel in the grid', () => {
  const { context } = unitsGame([PRIEST, STONE_THROWER]);
  expect(commandButtons(context(1, 'command'))).toEqual([{ kind: 'cancel', slot: 11 }]);
  expect(commandButtons(context(2, 'command'))).toEqual([{ kind: 'cancel', slot: 11 }]);
});

// Transport Boat and Trade Boat (docs/spec/naval.md §7.1, support-actions.md §7).
const TRANSPORT_BOAT = 17;
const TRADE_BOAT = 15;

test('a transport gets Unload in slot 0 (Stop then in 1) only while it carries someone', () => {
  const { world, context } = unitsGame([TRANSPORT_BOAT]);
  expect(commandButtons(context(1))).toEqual([{ kind: 'unselect', slot: 11 }]);
  world.entities.get(1)!.cargo = [99];
  expect(commandButtons(context(1))).toEqual([
    { kind: 'unload', slot: 0 },
    { kind: 'unselect', slot: 11 },
  ]);
  world.addBatch(world.turn, 1, [{ type: 'move', units: [1], x: 20, y: 20 }]);
  for (let i = 0; i < 40; i++) world.runStep();
  world.entities.get(1)!.cargo = [99];
  expect(bySlot(commandButtons(context(1))).slice(0, 2)).toEqual([
    { kind: 'unload', slot: 0 },
    { kind: 'stop', slot: 1 },
  ]);
});

test('a trade boat gets the food, wood and stone trade buttons in slots 1-3', () => {
  const { context } = unitsGame([TRADE_BOAT]);
  expect(commandButtons(context(1))).toEqual([
    { kind: 'trade', slot: 1, attribute: 0 },
    { kind: 'trade', slot: 2, attribute: 1 },
    { kind: 'trade', slot: 3, attribute: 2 },
    { kind: 'unselect', slot: 11 },
  ]);
});
