import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { startingObjects, World } from '@aoe/sim';
import type { AssetProvider } from '../assets';
import { CommandPanel } from './command-panel';

// The message line is a plain object: the panel only reads and writes its text, colour, hidden flag and dataset.
function line(): HTMLElement {
  return { textContent: '', style: { color: '' }, hidden: true, dataset: {} } as unknown as HTMLElement;
}

// Palette index i as the colour 0x010000 * i + i, so each index shows as its own colour.
const provider = {
  string: (id: number) => (id === 3001 ? 'You need more food' : id === 3002 ? 'You need more wood' : undefined),
  mapArt: () => ({ rgb: (i: number) => i * 0x010101 }),
} as unknown as AssetProvider;

function panel(message: HTMLElement): CommandPanel {
  const world = new World({ players: 3, units: startingObjects(3) });
  return new CommandPanel({
    slots: [],
    message,
    world,
    provider,
    player: 1,
    culture: 0,
    issue: () => {},
    startPlacement: () => {},
    cancelPlacement: () => {},
    unselect: () => {},
    group: () => {},
    ungroup: () => {},
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', { addEventListener: () => {}, removeEventListener: () => {} });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('a refusal (not enough food) stays 8 s as the original’s BadMessage, in palette 0x56', () => {
  const message = line();
  panel(message).refuse([{ type: 0, amount: 1e6 }]);
  expect(message.textContent).toBe('You need more food');
  expect(message.hidden).toBe(false);
  expect(message.dataset.bad).toBe('true');
  expect(message.style.color).toBe('#565656');
  vi.advanceTimersByTime(7999);
  expect(message.hidden).toBe(false);
  vi.advanceTimersByTime(1);
  expect(message.hidden).toBe(true);
});

test('a can’t-do message stays 8 s in palette 0x55', () => {
  const message = line();
  panel(message).warn('Not close enough');
  expect(message.style.color).toBe('#555555');
  vi.advanceTimersByTime(7999);
  expect(message.hidden).toBe(false);
  vi.advanceTimersByTime(1);
  expect(message.hidden).toBe(true);
});

test('a plain message (an order mode’s prompt) still stays 4 s', () => {
  const message = line();
  panel(message).say('Click an area to move there.');
  vi.advanceTimersByTime(3999);
  expect(message.hidden).toBe(false);
  vi.advanceTimersByTime(1);
  expect(message.hidden).toBe(true);
});

test('a mouse move takes a refusal or a plain message away, but not an object’s rollover text', () => {
  const message = line();
  const p = panel(message);
  p.refuse([{ type: 0, amount: 1e6 }]);
  expect(message.hidden).toBe(false);
  p.clearMessage();
  expect(message.hidden).toBe(true);
  expect(message.dataset.bad).toBeUndefined();
  p.say('Click an area to move there.');
  p.clearMessage();
  expect(message.hidden).toBe(true);
  // The timer of the cleared message does not hide a later one early.
  p.warn('Not close enough');
  vi.advanceTimersByTime(7999);
  expect(message.hidden).toBe(false);
  message.dataset.rollover = 'true';
  p.clearMessage();
  expect(message.hidden).toBe(false);
});
