/** Wire messages between client and relay server. One JSON object per WebSocket text frame, tagged by `t`. */

import { BUFFER_FRAMES, CIV_COUNT, CIV_RANDOM, COMMAND_DELAY_TURNS, DEFAULT_GAME_SETTINGS, isLobbyCiv, STEP_MS, type Command, type GameSettings, type SpeedChange } from '@aoe/sim';

/** Games start at `STEP_MS` per step and `BUFFER_FRAMES`; the server retunes both (docs/spec/turn-timing.md §8). */
export { BUFFER_FRAMES, COMMAND_DELAY_TURNS, STEP_MS, type Command, type SpeedChange };
/** The lobby's settings and civs (docs/spec/lobby.md). */
export { CIV_COUNT, CIV_RANDOM, DEFAULT_GAME_SETTINGS, isLobbyCiv, type GameSettings };
export const MAX_PLAYERS = 2;
export const MAX_NAME_LENGTH = 24;
export const MAX_COMMANDS_PER_BATCH = 256;
/** A chat message's text: `TXChat` sends at most 255 characters (src/com_hand.cpp:1972-1981; docs/spec/chat.md §3). */
export const MAX_CHAT_LENGTH = 255;

/** Invite code: 5 characters, no 0/O/1/I/L lookalikes; matched case-insensitively. */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 5;

/** Player slot, 0 or 1. Slot 0 is the room host. */
export type Slot = number;

export interface PlayerInfo {
  slot: Slot;
  name: string;
  ready: boolean;
  /** The player's civilization drop-down: 1 Egyptian .. 16 Macedonian, 17 Random (docs/spec/lobby.md §3). */
  civ: number;
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
  /** Host only, while not ready: the map type, map size and victory condition (docs/spec/lobby.md §2, §4). */
  | { t: 'settings'; settings: GameSettings }
  /** This player's civilization, while not ready (docs/spec/lobby.md §3, §4). */
  | { t: 'civ'; civ: number }
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
  /**
   * Take slot `slot` of started room `code` back after this client's socket dropped (docs/spec/turn-timing.md §9).
   * `token` is the one `start` gave this client; `received` is how many released turns it has (it gets the rest).
   */
  | { t: 'rejoin'; code: string; slot: Slot; token: string; received: number }
  /**
   * A chat message for the players in `to` (`TXChat`'s `DestPlayers`, docs/spec/chat.md §3), in the lobby or the game.
   * Outside the turns: it never reaches the sim. The sender shows its own copy itself.
   */
  | { t: 'chat'; text: string; to: Slot[] }
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
  | 'bad-turn'
  /** The room, slot or token of a `rejoin` is wrong, or the slot was dropped. */
  | 'bad-rejoin'
  /** A ready player's civ, or the settings while the host is ready, cannot change (docs/spec/lobby.md §4). */
  | 'locked';

export type EndReason = 'peer-left';

export type ServerMessage =
  /** Sent on create/join and whenever the lobby changes. `you` is the receiver's slot. */
  | { t: 'lobby'; code: string; you: Slot; players: PlayerInfo[]; settings: GameSettings }
  /**
   * The game begins. Every client seeds its sim with `seed` and submits each turn's batch once it has run it. `token`
   * is the receiver's own: it takes the slot back with `rejoin` after a dropped socket. `settings` and each player's
   * `civ` are the lobby's at the start (`lobbyWorldOptions` turns them into the world).
   */
  | { t: 'start'; seed: number; commandDelay: number; players: PlayerInfo[]; settings: GameSettings; token: string }
  /**
   * Answer to a good `rejoin`: the slot is this client's again. `nextTurn` is the first turn the server has no batch
   * of it for: the client sends its batches from there. The released turns it lacks follow as `turn` messages.
   */
  | { t: 'rejoined'; nextTurn: number }
  /**
   * The player in `slot` stayed away `DROP_AFTER_MS` and is dropped: the server sends a `resign` in its next batch and
   * empty ones after it (`COMM_OTHER_PLAYER_DROPPED`, docs/spec/turn-timing.md §9).
   */
  | { t: 'dropped'; slot: Slot }
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
  /** Player `from`'s chat message to this client (docs/spec/chat.md §3). */
  | { t: 'chat'; from: Slot; text: string }
  | { t: 'ended'; reason: EndReason }
  | { t: 'error'; code: ErrorCode; message: string };

/**
 * A player whose socket dropped is dropped from the game this long after the server last heard from it: the original's
 * non-host timeout (`0x1D6B4` ms, src/com_hand.cpp:560). Until then it may `rejoin`.
 */
export const DROP_AFTER_MS = 120_500;

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
