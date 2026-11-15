import { describe, expect, test } from 'vitest';
import {
  CODE_ALPHABET,
  decodeClientMessage,
  decodeServerMessage,
  encode,
  isValidCode,
  normalizeCode,
  packageName,
  type ClientMessage,
} from './index';

test('exports its package name', () => {
  expect(packageName).toBe('@aoe/protocol');
});

describe('invite codes', () => {
  test('alphabet has no lookalike characters', () => {
    for (const ch of '01OIL') expect(CODE_ALPHABET).not.toContain(ch);
  });
  test('normalize uppercases and strips separators', () => {
    expect(normalizeCode(' ab-c d2 ')).toBe('ABCD2');
  });
  test('validity checks length and alphabet', () => {
    expect(isValidCode('ABCD2')).toBe(true);
    expect(isValidCode('ABCD')).toBe(false);
    expect(isValidCode('ABCD0')).toBe(false);
  });
});

describe('client message decoding', () => {
  const roundTrips: ClientMessage[] = [
    { t: 'create', name: 'Eric' },
    { t: 'join', code: 'ABCD2', name: 'Bao' },
    { t: 'ready', ready: true },
    { t: 'start' },
    { t: 'turn', turn: 3, commands: [{ type: 'test', x: 10.5, y: 12 }, { type: 'noop' }] },
    { t: 'turn', turn: 9, commands: [], frameMs: 17 },
    { t: 'hash', turn: 3, hash: 0xdeadbeef },
    { t: 'pong', n: 4 },
    { t: 'rejoin', code: 'ABCD2', slot: 1, token: 'f00d', received: 12 },
    { t: 'leave' },
  ];
  test.each(roundTrips)('round-trips $t', (m) => {
    expect(decodeClientMessage(encode(m))).toEqual({ ok: true, message: m });
  });

  test.each([
    ['not json', '{'],
    ['no tag', '{}'],
    ['unknown tag', '{"t":"nope"}'],
    ['array', '[]'],
    ['name too long', JSON.stringify({ t: 'create', name: 'x'.repeat(25) })],
    ['negative turn', JSON.stringify({ t: 'turn', turn: -1, commands: [] })],
    ['fractional turn', JSON.stringify({ t: 'turn', turn: 1.5, commands: [] })],
    ['command without type', JSON.stringify({ t: 'turn', turn: 0, commands: [{ x: 1 }] })],
    ['unknown command type', JSON.stringify({ t: 'turn', turn: 0, commands: [{ type: 'move', unit: 2 }] })],
    ['bad command field', JSON.stringify({ t: 'turn', turn: 0, commands: [{ type: 'test', x: '1', y: 2 }] })],
    ['too many commands', JSON.stringify({ t: 'turn', turn: 0, commands: Array(257).fill({ type: 'noop' }) })],
    ['hash out of range', JSON.stringify({ t: 'hash', turn: 0, hash: 2 ** 32 })],
    ['frame time out of range', JSON.stringify({ t: 'turn', turn: 0, commands: [], frameMs: 256 })],
    ['pong without number', JSON.stringify({ t: 'pong' })],
    ['rejoin without token', JSON.stringify({ t: 'rejoin', code: 'ABCD2', slot: 0, received: 0 })],
    ['rejoin with negative received', JSON.stringify({ t: 'rejoin', code: 'ABCD2', slot: 0, token: 'a', received: -1 })],
  ])('rejects %s', (_label, raw) => {
    expect(decodeClientMessage(raw).ok).toBe(false);
  });

  test('trims names', () => {
    expect(decodeClientMessage('{"t":"create","name":"  Eric "}')).toEqual({
      ok: true,
      message: { t: 'create', name: 'Eric' },
    });
  });
});

test('server message decoding checks the tag', () => {
  expect(decodeServerMessage('{"t":"ended","reason":"peer-left"}').ok).toBe(true);
  expect(decodeServerMessage('{"t":"rejoined","nextTurn":3}').ok).toBe(true);
  expect(decodeServerMessage('{"t":"dropped","slot":1}').ok).toBe(true);
  expect(decodeServerMessage('{"t":"create"}').ok).toBe(false);
});
