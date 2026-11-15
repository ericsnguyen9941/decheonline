import { describe, expect, test } from 'vitest';
import { BUILDER, HOUSE, LUMBERJACK, ObjectState, startingObjects, TECH_DONE, TECH_RESEARCHING, TOOL_AGE, TOWN_CENTER, TREES, VILLAGER, World, type Entity } from '@aoe/sim';
import type { SoundTable } from '../assets';
import { GameSounds } from './game-sounds';
import type { SoundPlayer } from './sound-player';
import { GameSound, pickWav, researchSound, selectSound, spriteSounds, UnitSound } from './sound-rules';

// `[selected, created, death, command, move, construction]` of these masters in data2/empires.dat
// (npm run dat:dump -- unit <id>).
const UNIT_SOUNDS: Record<number, number[]> = {
  [VILLAGER]: [47, 114, -1, 206, 206, -1],
  [BUILDER]: [47, 144, -1, 201, 206, -1],
  [LUMBERJACK]: [47, 114, -1, 207, 206, -1],
  [TOWN_CENTER]: [185, -1, 70, -1, -1, 185],
  [HOUSE]: [113, -1, -1, -1, -1, 113],
  [TREES[0]]: [140, -1, -1, -1, -1, -1],
};
// Graphic 465 (Clubman attack) plays sound 121 at frame 10 of each facet; 196 (a death) plays 52 as it starts.
const GRAPHIC_SOUNDS: Record<number, { sound: number; frameSounds: [number, number][][] | null }> = {
  465: { sound: -1, frameSounds: [[[10, 121]], [[10, 121]], [[3, 122]]] },
  196: { sound: 52, frameSounds: null },
};

// Every dat sound one wav (its own id + 1000) at 100%, so the pick is certain; 10 (the attack warning) and the
// game's wavs exist.
const table: SoundTable = {
  sound: (id) => [[id + 1000, 100]],
  unitSounds: (id) => UNIT_SOUNDS[id] ?? null,
  graphicSounds: (id) => GRAPHIC_SOUNDS[id] ?? null,
  wavUrl: (id) => `/assets/sounds/${id}.wav`,
};

function game() {
  const world = new World({ players: 3, units: startingObjects(3) });
  const played: [string, boolean][] = [];
  const audio = { volume: 0, play: (url: string, restart = true) => played.push([url, restart]) } as unknown as SoundPlayer;
  const sounds = new GameSounds({ world, player: 1, table, audio });
  return { world, sounds, played };
}

const own = (world: World, player: number, type: number) => [...world.entities.ofPlayer(player)].find((e) => e.type === type)!;
const step = (world: World, sounds: GameSounds) => {
  world.runStep();
  sounds.update();
};
const last = (sounds: GameSounds) => sounds.log.at(-1);

describe('pickWav', () => {
  test('takes each percent off rand * 100 / 0x7fff in turn', () => {
    const items = [
      [1, 30],
      [2, 30],
      [3, 40],
    ] as const;
    expect(pickWav(items, 0)).toBe(1);
    // Up to 30 (rand 10157) the first 30 takes it to 0 or below; 31 (rand 10158) goes on to the second.
    expect(pickWav(items, 10157)).toBe(1);
    expect(pickWav(items, 10158)).toBe(2);
    expect(pickWav(items, 0x7fff)).toBe(3);
  });

  test('plays nothing when the percents run out first', () => {
    expect(pickWav([[1, 50]], 0x7fff)).toBeNull();
    expect(pickWav([], 0)).toBeNull();
  });
});

test('a click selects an own or Gaia object with its sound, another player’s without', () => {
  expect(selectSound(table, VILLAGER, 1, 1)).toBe(47);
  expect(selectSound(table, TREES[0], 0, 1)).toBe(140);
  expect(selectSound(table, VILLAGER, 2, 1)).toBe(-1);
  expect(selectSound(table, 9999, 1, 1)).toBe(-1);
});

describe('spriteSounds', () => {
  test('frame sounds of the facet drawn, as their frame is passed', () => {
    expect(spriteSounds(table, 465, 9, 10, 0)).toEqual([]);
    expect(spriteSounds(table, 465, 10, 11, 0)).toEqual([121]);
    expect(spriteSounds(table, 465, 8, 12, 1)).toEqual([121]);
    expect(spriteSounds(table, 465, 2, 4, 2)).toEqual([122]);
    // Across the wrap: from the last frames onto the first ones.
    expect(spriteSounds(table, 465, 12, 1, 0)).toEqual([]);
    expect(spriteSounds(table, 465, 9, 1, 0)).toEqual([121]);
    // A facet past the list reads the first one's.
    expect(spriteSounds(table, 465, 10, 11, 7)).toEqual([121]);
  });

  test('the main sound on leaving frame 0, or wrapping onto a later frame', () => {
    expect(spriteSounds(table, 196, 0, 1, 0)).toEqual([52]);
    expect(spriteSounds(table, 196, 1, 2, 0)).toEqual([]);
    expect(spriteSounds(table, 196, 5, 1, 0)).toEqual([52]);
    expect(spriteSounds(table, 196, 5, 0, 0)).toEqual([]);
    expect(spriteSounds(table, 9999, 0, 1, 0)).toEqual([]);
  });
});

test('an age plays resdone.wav, any other research res.wav', () => {
  expect([101, 102, 103].map(researchSound)).toEqual([GameSound.AgeDone, GameSound.AgeDone, GameSound.AgeDone]);
  expect(researchSound(TOOL_AGE + 10)).toBe(GameSound.ResearchDone);
});

describe('GameSounds', () => {
  test('orders: move sound for a move, the task master’s command sound for work, the builder’s for a build', () => {
    const { world, sounds, played } = game();
    const v = own(world, 1, VILLAGER);
    sounds.command({ type: 'move', units: [v.id], x: 10, y: 10 });
    expect(last(sounds)).toEqual({ event: 'move', sound: 206, game: -1, wav: 1206, source: VILLAGER });
    expect(played.at(-1)).toEqual(['/assets/sounds/1206.wav', true]);
    const tree = [...world.entities.ofPlayer(0)].find((e: Entity) => (TREES as readonly number[]).includes(e.type))!;
    sounds.command({ type: 'work', units: [v.id], target: tree.id, x: tree.x, y: tree.y });
    expect(last(sounds)).toMatchObject({ event: 'command', sound: 207, source: LUMBERJACK });
    sounds.command({ type: 'build', units: [v.id], unitType: HOUSE, x: 12, y: 12 });
    expect(last(sounds)).toMatchObject({ event: 'command', sound: 201, source: BUILDER });
    sounds.command({ type: 'stop', objects: [v.id] });
    expect(last(sounds)).toMatchObject({ event: 'command', sound: 206, source: VILLAGER });
    const count = sounds.log.length;
    sounds.command({ type: 'move', units: [], x: 1, y: 1 });
    expect(sounds.log.length).toBe(count);
  });

  test('selection sound of own and Gaia objects only', () => {
    const { world, sounds } = game();
    sounds.selected(own(world, 1, VILLAGER));
    expect(last(sounds)).toMatchObject({ event: 'select', sound: 47, wav: 1047 });
    const count = sounds.log.length;
    sounds.selected(own(world, 2, VILLAGER));
    expect(sounds.log.length).toBe(count);
  });

  test('the objects the game starts with make no sound; an own object made, finished or dying does', () => {
    const { world, sounds } = game();
    step(world, sounds);
    expect(sounds.log).toEqual([]);
    const v = own(world, 1, VILLAGER);
    world.createUnit({ owner: 1, type: VILLAGER, x: v.x + 1, y: v.y });
    world.createUnit({ owner: 2, type: VILLAGER, x: v.x + 2, y: v.y });
    step(world, sounds);
    expect(sounds.log).toEqual([{ event: 'created', sound: 114, game: -1, wav: 1114, source: VILLAGER }]);
    const house = world.createObject(1, HOUSE, v.x + 4, v.y + 4, 0);
    expect(house.state).toBe(ObjectState.Unbuilt);
    step(world, sounds);
    house.state = ObjectState.Active;
    step(world, sounds);
    expect(last(sounds)).toEqual({ event: 'built', sound: 113, game: -1, wav: 1113, source: HOUSE });
    const tc = own(world, 1, TOWN_CENTER);
    tc.state = ObjectState.Dying;
    step(world, sounds);
    expect(last(sounds)).toMatchObject({ event: 'death', sound: 70, source: TOWN_CENTER });
  });

  test('research done and the under-attack alert', () => {
    const { world, sounds, played } = game();
    world.techs[1]![TOOL_AGE] = TECH_RESEARCHING;
    step(world, sounds);
    world.techs[1]![TOOL_AGE] = TECH_DONE;
    step(world, sounds);
    expect(last(sounds)).toEqual({ event: 'research', sound: -1, game: GameSound.AgeDone, wav: 50305, source: TOOL_AGE });
    // A game sound is left alone while it still plays.
    expect(played.at(-1)).toEqual(['/assets/sounds/50305.wav', false]);
    world.alertCooldown[1] = 20;
    step(world, sounds);
    const warning = Math.trunc(world.attributes[1]![26]!);
    expect(warning).toBeGreaterThanOrEqual(0);
    expect(last(sounds)).toMatchObject({ event: 'attacked', sound: warning, wav: warning + 1000 });
    // The cooldown running down plays nothing more.
    const count = sounds.log.length;
    step(world, sounds);
    expect(sounds.log.length).toBe(count);
  });

  test('a game screen button restarts button2.wav', () => {
    const { sounds, played } = game();
    sounds.button();
    expect(last(sounds)).toEqual({ event: 'button', sound: -1, game: GameSound.Button, wav: 50301, source: -1 });
    expect(played.at(-1)).toEqual(['/assets/sounds/50301.wav', true]);
  });

  test('every slot is read from its place in the master’s list', () => {
    expect(UnitSound).toEqual({ Selected: 0, Created: 1, Death: 2, Command: 3, Move: 4, Construction: 5 });
  });
});
