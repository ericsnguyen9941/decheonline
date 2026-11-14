import { parseCommand } from '@aoe/sim';
import {
  MAX_COMMANDS_PER_BATCH,
  MAX_NAME_LENGTH,
  type ClientMessage,
  type Command,
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
    case 'start':
      return { ok: true, message: { t: 'start' } };
    case 'leave':
      return { ok: true, message: { t: 'leave' } };
    case 'turn': {
      const cmds = commands(v['commands']);
      const frameMs = v['frameMs'];
      if (!isTurn(v['turn']) || cmds === null) return fail('bad turn batch');
      if (frameMs === undefined) return { ok: true, message: { t: 'turn', turn: v['turn'], commands: cmds } };
      if (!isTurn(frameMs) || frameMs > 255) return fail('bad frame time');
      return { ok: true, message: { t: 'turn', turn: v['turn'], commands: cmds, frameMs } };
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

const SERVER_TAGS = new Set(['lobby', 'start', 'turn', 'ping', 'rtt', 'desync', 'ended', 'error']);

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
