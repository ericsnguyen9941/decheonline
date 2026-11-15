import { describe, expect, test } from 'vitest';
import { selectKey, tabTarget, type SelectLetters } from './select-keys';

// The letters of the English language.dll: H town center, N B D A K L P Y buildings, U ungroup, M move.
const letters: SelectLetters = { townCenter: 'H', buildings: ['N', 'B', 'D', 'A', 'K', 'L', 'P', 'Y'], ungroup: 'U', move: 'M' };
const key = (k: string, mods: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {}, buildMenu = false) =>
  selectKey({ key: k, ctrlKey: !!mods.ctrl, shiftKey: !!mods.shift, altKey: !!mods.alt }, k.length === 1 ? k.toUpperCase() : null, letters, buildMenu);

describe('selectKey', () => {
  test('the Town Center key selects master 109, with or without Ctrl', () => {
    expect(key('h')).toEqual({ kind: 'building', master: 0x6d });
    expect(key('h', { ctrl: true })).toEqual({ kind: 'building', master: 0x6d });
  });
  test('Ctrl plus a building letter selects that master; the letter alone does nothing', () => {
    expect(key('b', { ctrl: true })).toEqual({ kind: 'building', master: 0x0c });
    expect(key('y', { ctrl: true })).toEqual({ kind: 'building', master: 0 });
    expect(key('b')).toBeNull();
  });
  test('Move and Ungroup need no Ctrl and are off in the build menu', () => {
    expect(key('m')).toEqual({ kind: 'move' });
    expect(key('u', { shift: true })).toEqual({ kind: 'ungroup' });
    expect(key('m', { ctrl: true })).toBeNull();
    expect(key('m', {}, true)).toBeNull();
    expect(key('h', {}, true)).toEqual({ kind: 'building', master: 0x6d });
  });
  test('Alt takes no letter; Tab steps forward, Shift+Tab back', () => {
    expect(key('h', { alt: true })).toBeNull();
    expect(key('Tab')).toEqual({ kind: 'tab', forward: true });
    expect(key('Tab', { shift: true })).toEqual({ kind: 'tab', forward: false });
    expect(key('Tab', { ctrl: true })).toBeNull();
  });
  test('Work and Attack are unbound (their hotkeys are 0)', () => {
    expect(key('w')).toBeNull();
    expect(key('a')).toBeNull();
  });
});

describe('tabTarget (command_tab_selected)', () => {
  const order = [5, 6, 7];
  test('forward takes the next and wraps to the first', () => {
    expect(tabTarget(order, 5, true)).toBe(6);
    expect(tabTarget(order, 6, true)).toBe(7);
    expect(tabTarget(order, 7, true)).toBe(5);
  });
  test('backward takes the previous and wraps to the last', () => {
    expect(tabTarget(order, 7, false)).toBe(6);
    expect(tabTarget(order, 6, false)).toBe(5);
    expect(tabTarget(order, 5, false)).toBe(7);
  });
  test('one selected object has nothing to step to', () => {
    expect(tabTarget([5], 5, true)).toBeNull();
    expect(tabTarget([], null, false)).toBeNull();
  });
});
