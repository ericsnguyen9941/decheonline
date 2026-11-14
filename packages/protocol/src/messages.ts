/** Wire messages between client and relay server. One JSON object per WebSocket text frame, tagged by `t`. */

/** Turn length the server tells clients to run at (original AoE1: about 200 ms). */
export const TURN_MS = 200;
/** Commands issued during turn N are scheduled for turn N + COMMAND_DELAY_TURNS (original AoE1: 2). */
export const COMMAND_DELAY_TURNS = 2;
export const MAX_PLAYERS = 2;
export const MAX_NAME_LENGTH = 24;
export const MAX_COMMANDS_PER_BATCH = 256;

/** Invite code: 5 characters, no 0/O/1/I/L lookalikes; matched case-insensitively. */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 5;

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** One player command. The sim owns the vocabulary of `type`; the relay never looks past it. */
export type Command = { type: string } & { [key: string]: JsonValue };

/** Player slot, 0 or 1. Slot 0 is the room host. */
export type Slot = number;

export interface PlayerInfo {
  slot: Slot;
  name: string;
  ready: boolean;
}

export interface TurnBatch {
  slot: Slot;
  commands: Command[];
}

// Client -> server

export type ClientMessage =
  | { t: 'create'; name: string }
  | { t: 'join'; code: string; name: string }
  | { t: 'ready'; ready: boolean }
  /** Host only, once every player is ready. */
  | { t: 'start' }
  /**
   * Commands for turn `turn`. Each client sends exactly one batch per turn, in order starting at 0
   * (empty batches included), up to MAX_TURNS_AHEAD past the last turn the server has released.
   */
  | { t: 'turn'; turn: number; commands: Command[] }
  /** Hash of the sim state after executing `turn`. */
  | { t: 'hash'; turn: number; hash: number }
  | { t: 'leave' };

// Server -> client

export type ErrorCode =
  | 'bad-message'
  | 'bad-code'
  | 'room-full'
  | 'room-started'
  | 'already-in-room'
  | 'not-in-room'
  | 'not-host'
  | 'not-ready'
  | 'not-started'
  | 'bad-turn';

export type EndReason = 'peer-left';

export type ServerMessage =
  /** Sent on create/join and whenever the lobby changes. `you` is the receiver's slot. */
  | { t: 'lobby'; code: string; you: Slot; players: PlayerInfo[] }
  /** The game begins. Every client seeds its sim with `seed` and submits turn 0 and 1 batches. */
  | { t: 'start'; seed: number; turnMs: number; commandDelay: number; players: PlayerInfo[] }
  /** Both batches for `turn`, ordered by slot. Released strictly in turn order. */
  | { t: 'turn'; turn: number; batches: TurnBatch[] }
  /** State hashes for `turn` disagreed. `hashes` is indexed by slot. */
  | { t: 'desync'; turn: number; hashes: number[] }
  | { t: 'ended'; reason: EndReason }
  | { t: 'error'; code: ErrorCode; message: string };

/** The server buffers at most this many unreleased turns per player. */
export const MAX_TURNS_AHEAD = 64;

/** Uppercase and drop spaces/dashes, so "ab-c d2" matches "ABCD2". */
export function normalizeCode(raw: string): string {
  return raw.replace(/[\s-]/g, '').toUpperCase();
}

export function isValidCode(code: string): boolean {
  if (code.length !== CODE_LENGTH) return false;
  for (const ch of code) if (!CODE_ALPHABET.includes(ch)) return false;
  return true;
}
