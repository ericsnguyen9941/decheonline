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
    { t: 'settings', settings: { mapType: 7, mapSize: 96, victory: { type: 0 }, populationLimit: 50 } },
    { t: 'settings', settings: { mapType: 3, mapSize: 250, victory: { type: 2, amount: 9000 }, populationLimit: 200 } },
    { t: 'settings', settings: { mapType: 4, mapSize: 72, victory: { type: 3, amount: 300 }, populationLimit: 25 } },
    { t: 'civ', civ: 1 },
    { t: 'civ', civ: 17 },
    { t: 'start' },
    { t: 'turn', turn: 3, commands: [{ type: 'test', x: 10.5, y: 12 }, { type: 'noop' }] },
    { t: 'turn', turn: 9, commands: [], frameMs: 17 },
    { t: 'hash', turn: 3, hash: 0xdeadbeef },
    { t: 'pong', n: 4 },
    { t: 'rejoin', code: 'ABCD2', slot: 1, token: 'f00d', received: 12 },
    { t: 'chat', text: 'hi: there', to: [0, 1] },
    { t: 'chat', text: 'x'.repeat(255), to: [] },
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
    ['map type the sim cannot play', JSON.stringify({ t: 'settings', settings: { mapType: 0, mapSize: 144, victory: { type: 0 }, populationLimit: 50 } })],
    ['map size not offered', JSON.stringify({ t: 'settings', settings: { mapType: 3, mapSize: 100, victory: { type: 0 }, populationLimit: 50 } })],
    ['special victory', JSON.stringify({ t: 'settings', settings: { mapType: 3, mapSize: 144, victory: { type: 4 }, populationLimit: 50 } })],
    ['time limit not offered', JSON.stringify({ t: 'settings', settings: { mapType: 3, mapSize: 144, victory: { type: 2, amount: 100 }, populationLimit: 50 } })],
    ['time limit without years', JSON.stringify({ t: 'settings', settings: { mapType: 3, mapSize: 144, victory: { type: 2 }, populationLimit: 50 } })],
    ['standard with an amount', JSON.stringify({ t: 'settings', settings: { mapType: 3, mapSize: 144, victory: { type: 0, amount: 900 }, populationLimit: 50 } })],
    ['settings without victory', JSON.stringify({ t: 'settings', settings: { mapType: 3, mapSize: 144, populationLimit: 50 } })],
    ['population limit not offered', JSON.stringify({ t: 'settings', settings: { mapType: 3, mapSize: 144, victory: { type: 0 }, populationLimit: 60 } })],
    ['settings without population limit', JSON.stringify({ t: 'settings', settings: { mapType: 3, mapSize: 144, victory: { type: 0 } } })],
    ['civ 0 (Gaia)', JSON.stringify({ t: 'civ', civ: 0 })],
    ['civ past Random', JSON.stringify({ t: 'civ', civ: 18 })],
    ['rejoin without token', JSON.stringify({ t: 'rejoin', code: 'ABCD2', slot: 0, received: 0 })],
    ['empty chat', JSON.stringify({ t: 'chat', text: '', to: [1] })],
    ['chat past 255 characters', JSON.stringify({ t: 'chat', text: 'x'.repeat(256), to: [1] })],
    ['chat to slot 2', JSON.stringify({ t: 'chat', text: 'hi', to: [2] })],
    ['chat without recipients', JSON.stringify({ t: 'chat', text: 'hi' })],
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
  expect(decodeServerMessage('{"t":"chat","from":0,"text":"hi"}').ok).toBe(true);
  expect(decodeServerMessage('{"t":"create"}').ok).toBe(false);
});
