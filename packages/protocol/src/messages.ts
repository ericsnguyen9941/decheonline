/** Wire messages between client and relay server. One JSON object per WebSocket text frame, tagged by `t`. */

import { BUFFER_FRAMES, COMMAND_DELAY_TURNS, STEP_MS, type Command, type SpeedChange } from '@aoe/sim';

/** Games start at `STEP_MS` per step and `BUFFER_FRAMES`; the server retunes both (docs/spec/turn-timing.md §8). */
export { BUFFER_FRAMES, COMMAND_DELAY_TURNS, STEP_MS, type Command, type SpeedChange };
export const MAX_PLAYERS = 2;
export const MAX_NAME_LENGTH = 24;
export const MAX_COMMANDS_PER_BATCH = 256;

/** Invite code: 5 characters, no 0/O/1/I/L lookalikes; matched case-insensitively. */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 5;

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
   * Commands issued during turn `turn`, sent when the client has run it; they execute on `turn + COMMAND_DELAY_TURNS`.
   * Each client sends exactly one batch per turn, in order starting at 0 (empty batches included), up to
   * MAX_TURNS_AHEAD past the last turn the server has released. `frameMs`: the client's mean frame time, whole ms
   * up to 255, once it has one (docs/spec/turn-timing.md §8.4).
   */
  | { t: 'turn'; turn: number; commands: Command[]; frameMs?: number }
  /** Hash of the sim state after executing `turn`. */
  | { t: 'hash'; turn: number; hash: number }
  /** Answer to the server's `ping` `n`, sent at once. */
  | { t: 'pong'; n: number }
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
  /** The game begins. Every client seeds its sim with `seed` and submits each turn's batch once it has run it. */
  | { t: 'start'; seed: number; commandDelay: number; players: PlayerInfo[] }
  /**
   * Both batches issued during `turn`, ordered by slot. Released strictly in turn order. `speed`: the step size and
   * buffer frames the server agreed for turn `speed.turn` (later than `turn + COMMAND_DELAY_TURNS`); give it to the
   * sim when this batch is.
   */
  | { t: 'turn'; turn: number; batches: TurnBatch[]; speed?: SpeedChange }
  /** Round-trip probe; answer with `pong` (docs/spec/turn-timing.md §8.3). */
  | { t: 'ping'; n: number }
  /** The server's latest round trip to each slot, ms (0 before the first). */
  | { t: 'rtt'; rtt: number[] }
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
