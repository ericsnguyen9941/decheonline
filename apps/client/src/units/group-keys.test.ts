import { describe, expect, it } from 'vitest';
import { groupKey } from './group-keys';

const key = (code: string, mods: Partial<Record<'ctrlKey' | 'shiftKey' | 'altKey', boolean>> = {}) =>
  groupKey({ code, ctrlKey: false, shiftKey: false, altKey: false, ...mods });

describe('groupKey', () => {
  it('maps the digit row to groups 1-10, 0 being 10', () => {
    expect(key('Digit1')?.id).toBe(1);
    expect(key('Digit9')?.id).toBe(9);
    expect(key('Digit0')?.id).toBe(10);
  });

  it('ignores other keys and the numpad', () => {
    expect(key('KeyA')).toBeNull();
    expect(key('Numpad1')).toBeNull();
  });

  it('assigns with Ctrl, adds with Shift, centres with Alt, recalls bare', () => {
    expect(key('Digit2', { ctrlKey: true })).toEqual({ id: 2, action: 'assign', add: false, centre: false });
    expect(key('Digit2', { shiftKey: true })).toEqual({ id: 2, action: 'select', add: true, centre: false });
    expect(key('Digit2', { altKey: true })).toEqual({ id: 2, action: 'select', add: false, centre: true });
    expect(key('Digit2')).toEqual({ id: 2, action: 'select', add: false, centre: false });
  });

  it('takes Ctrl before Shift before Alt, as the original', () => {
    expect(key('Digit3', { ctrlKey: true, shiftKey: true })?.action).toBe('assign');
    expect(key('Digit3', { shiftKey: true, altKey: true })).toMatchObject({ add: true, centre: false });
  });
});
