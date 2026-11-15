import { isLobbyCiv, isLobbySettings, parseCommand } from '@aoe/sim';
import {
  MAX_CHAT_LENGTH,
  MAX_COMMANDS_PER_BATCH,
  MAX_NAME_LENGTH,
  MAX_PLAYERS,
  type ClientMessage,
  type Command,
  type GameSettings,
  type ServerMessage,
} from './messages';

export type Decoded<T> = { ok: true; message: T } | { ok: false; error: string };

type Obj = Record<string, unknown>;

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isTurn(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
}

function cleanName(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const name = v.trim();
  return name.length <= MAX_NAME_LENGTH ? name : null;
}

/** Every command must be in the sim's vocabulary; unknown fields are dropped. */
function commands(v: unknown): Command[] | null {
  if (!Array.isArray(v) || v.length > MAX_COMMANDS_PER_BATCH) return null;
  const out: Command[] = [];
  for (const c of v) {
    const command = parseCommand(c);
    if (command === null) return null;
    out.push(command);
  }
  return out;
}

/** A setting the lobby offers (`isLobbySettings`); unknown fields are dropped. */
function settings(v: unknown): GameSettings | null {
  if (!isObj(v) || !isObj(v['victory'])) return null;
  const { mapType, mapSize, populationLimit } = v;
  const { type, amount } = v['victory'];
  if (typeof mapType !== 'number' || typeof mapSize !== 'number' || typeof type !== 'number' || typeof populationLimit !== 'number') return null;
  if (amount !== undefined && typeof amount !== 'number') return null;
  const s: GameSettings = { mapType, mapSize, victory: amount === undefined ? { type } : { type, amount }, populationLimit };
  return isLobbySettings(s) ? s : null;
}

export function encode(message: ClientMessage | ServerMessage): string {
  return JSON.stringify(message);
}

/** Parse and validate a frame from a client. Never throws. */
export function decodeClientMessage(raw: string): Decoded<ClientMessage> {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return fail('not JSON');
  }
  if (!isObj(v) || typeof v['t'] !== 'string') return fail('missing message tag');
  switch (v['t']) {
    case 'create': {
      const name = cleanName(v['name']);
      if (name === null) return fail('bad name');
      return { ok: true, message: { t: 'create', name } };
    }
    case 'join': {
      const name = cleanName(v['name']);
      if (name === null) return fail('bad name');
      if (typeof v['code'] !== 'string' || v['code'].length > 32) return fail('bad code');
      return { ok: true, message: { t: 'join', code: v['code'], name } };
    }
    case 'ready':
      if (typeof v['ready'] !== 'boolean') return fail('bad ready flag');
      return { ok: true, message: { t: 'ready', ready: v['ready'] } };
    case 'settings': {
      const s = settings(v['settings']);
      if (s === null) return fail('bad settings');
      return { ok: true, message: { t: 'settings', settings: s } };
    }
    case 'civ': {
      const civ = v['civ'];
      if (typeof civ !== 'number' || !isLobbyCiv(civ)) return fail('bad civ');
      return { ok: true, message: { t: 'civ', civ } };
    }
    case 'start':
      return { ok: true, message: { t: 'start' } };
    case 'leave':
      return { ok: true, message: { t: 'leave' } };
    case 'rejoin': {
      const { code, slot, token, received } = v;
      if (typeof code !== 'string' || code.length > 32 || typeof token !== 'string' || token.length > 64) return fail('bad rejoin');
      if (!isTurn(slot) || !isTurn(received)) return fail('bad rejoin');
      return { ok: true, message: { t: 'rejoin', code, slot, token, received } };
    }
    case 'turn': {
      const cmds = commands(v['commands']);
      const frameMs = v['frameMs'];
      if (!isTurn(v['turn']) || cmds === null) return fail('bad turn batch');
      if (frameMs === undefined) return { ok: true, message: { t: 'turn', turn: v['turn'], commands: cmds } };
      if (!isTurn(frameMs) || frameMs > 255) return fail('bad frame time');
      return { ok: true, message: { t: 'turn', turn: v['turn'], commands: cmds, frameMs } };
    }
    case 'chat': {
      const { text, to } = v;
      if (typeof text !== 'string' || text.length === 0 || text.length > MAX_CHAT_LENGTH) return fail('bad chat text');
      if (!Array.isArray(to) || to.length > MAX_PLAYERS || !to.every((s) => isTurn(s) && s < MAX_PLAYERS)) return fail('bad chat recipients');
      return { ok: true, message: { t: 'chat', text, to: to as number[] } };
    }
    case 'pong':
      if (!isTurn(v['n'])) return fail('bad pong');
      return { ok: true, message: { t: 'pong', n: v['n'] } };
    case 'hash': {
      const h = v['hash'];
      if (!isTurn(v['turn']) || typeof h !== 'number' || !Number.isInteger(h) || h < 0 || h > 0xffffffff) {
        return fail('bad hash report');
      }
      return { ok: true, message: { t: 'hash', turn: v['turn'], hash: h } };
    }
    default:
      return fail('unknown message tag');
  }
}

const SERVER_TAGS = new Set(['lobby', 'start', 'rejoined', 'dropped', 'turn', 'ping', 'rtt', 'desync', 'chat', 'ended', 'error']);

/** Parse a frame from the server. Checks the tag only; the server is trusted to send well-formed bodies. */
export function decodeServerMessage(raw: string): Decoded<ServerMessage> {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return fail('not JSON');
  }
  if (!isObj(v) || typeof v['t'] !== 'string' || !SERVER_TAGS.has(v['t'])) return fail('unknown message tag');
  return { ok: true, message: v as unknown as ServerMessage };
}
