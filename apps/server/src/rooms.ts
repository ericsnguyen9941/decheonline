import { randomBytes, randomInt } from 'node:crypto';
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  COMMAND_DELAY_TURNS,
  DROP_AFTER_MS,
  MAX_PLAYERS,
  MAX_TURNS_AHEAD,
  isValidCode,
  normalizeCode,
  type ClientMessage,
  type Command,
  type ErrorCode,
  type PlayerInfo,
  type ServerMessage,
  type SpeedChange,
  type TurnBatch,
} from '@aoe/protocol';
import { highLatencyMs, SpeedHost } from './speed';

/** A player is pinged when this long passed since the last ping to it (`CheckPingTime`, turn-timing.md §3.1). */
export const PING_INTERVAL_MS = 8000;

/** One connected client, as the room logic sees it. */
export interface Peer {
  send(message: ServerMessage): void;
}

/** One released turn, as sent to both clients. */
export interface TurnRecord {
  turn: number;
  batches: TurnBatch[];
  speed?: SpeedChange;
}

interface Member {
  /** Null while the member's socket is away (dropped, not left) in a started game. */
  peer: Peer | null;
  name: string;
  ready: boolean;
  /** Next turn this member must submit. */
  nextTurn: number;
  /** Submitted but not yet released batches. */
  pending: Map<number, Command[]>;
  hashes: Map<number, number>;
  /** Latest round trip to this member, ms; 0 before the first. */
  rtt: number;
  /** Latest mean frame time the member reported, ms; 0 before the first. */
  frameMs: number;
  /** Number and send time of the latest ping. */
  pingN: number;
  pingAt: number;
  /** The secret `start` gave this member's client, for `rejoin`. */
  token: string;
  /** When the server last heard from this member, ms. */
  heardAt: number;
  /** Dropped after its socket stayed away `DROP_AFTER_MS`: the server fills its batches from then on. */
  dropped: boolean;
  /** Cancels the drop while the socket is away. */
  cancelDrop: (() => void) | null;
  /** Submitted a resign command: leaving no longer ends the game for the others. */
  resigned: boolean;
}

export class Room {
  readonly members: Member[] = [];
  /** Every turn released so far, in order. */
  readonly log: TurnRecord[] = [];
  readonly desyncs: number[] = [];
  started = false;
  seed = 0;
  /** Step size and buffer frames: the server plays the host (docs/spec/turn-timing.md §8.2). */
  readonly speed = new SpeedHost();

  constructor(readonly code: string) {}

  players(): PlayerInfo[] {
    return this.members.map((m, slot) => ({ slot, name: m.name, ready: m.ready }));
  }

  broadcast(message: ServerMessage): void {
    for (const m of this.members) m.peer?.send(message);
  }

  sendLobby(): void {
    const players = this.players();
    this.members.forEach((m, you) => m.peer?.send({ t: 'lobby', code: this.code, you, players }));
  }
}

export interface RoomRegistryOptions {
  /** Override code generation (tests). Must return a normalized, valid code. */
  generateCode?: () => string;
  /** Override the game seed (tests). */
  generateSeed?: () => number;
  /** Clock for round trips and drops, ms (tests). */
  now?: () => number;
  /** Override the rejoin tokens (tests). */
  generateToken?: () => string;
  /** Run `fn` after `ms`; returns a cancel function (tests). */
  schedule?: (fn: () => void, ms: number) => () => void;
}

function schedule(fn: () => void, ms: number): () => void {
  const timer = setTimeout(fn, ms);
  return () => clearTimeout(timer);
}

function randomCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

/** All rooms plus which room each connected peer is in. Pure logic: no sockets, no timers. */
export class RoomRegistry {
  readonly rooms = new Map<string, Room>();
  private readonly byPeer = new Map<Peer, Room>();
  private readonly generateCode: () => string;
  private readonly generateSeed: () => number;
  private readonly now: () => number;
  private readonly generateToken: () => string;
  private readonly schedule: (fn: () => void, ms: number) => () => void;

  constructor(options: RoomRegistryOptions = {}) {
    this.generateCode = options.generateCode ?? randomCode;
    this.generateSeed = options.generateSeed ?? (() => randomInt(2 ** 32));
    this.now = options.now ?? (() => performance.now());
    this.generateToken = options.generateToken ?? (() => randomBytes(16).toString('hex'));
    this.schedule = options.schedule ?? schedule;
  }

  roomOf(peer: Peer): Room | undefined {
    return this.byPeer.get(peer);
  }

  handle(peer: Peer, message: ClientMessage): void {
    switch (message.t) {
      case 'create':
        return this.create(peer, message.name);
      case 'join':
        return this.join(peer, message.code, message.name);
      case 'rejoin':
        return this.rejoin(peer, message.code, message.slot, message.token, message.received);
      case 'leave':
        return this.disconnect(peer);
      default:
        break;
    }
    const room = this.byPeer.get(peer);
    if (!room) return reject(peer, 'not-in-room', 'join or create a room first');
    const slot = room.members.findIndex((m) => m.peer === peer);
    const member = room.members[slot];
    if (!member) return reject(peer, 'not-in-room', 'join or create a room first');
    member.heardAt = this.now();
    if (room.started) this.ping(member, false);
    switch (message.t) {
      case 'ready':
        if (room.started) return reject(peer, 'room-started', 'game already started');
        member.ready = message.ready;
        return room.sendLobby();
      case 'start':
        return this.start(room, slot, peer);
      case 'turn':
        if (message.frameMs !== undefined && room.started) member.frameMs = message.frameMs;
        return this.submitTurn(room, member, peer, message.turn, message.commands);
      case 'pong':
        return this.pong(room, member, message.n);
      case 'hash':
        return this.reportHash(room, member, peer, message.turn, message.hash);
    }
  }

  /**
   * Remove a peer from its room: a leave message or a socket closed on purpose (`dropped` false), or a socket that broke
   * (`dropped`). In a started game a broken socket keeps its slot for `rejoin` until `DROP_AFTER_MS` after the server
   * last heard from it; then the player is dropped (docs/spec/turn-timing.md §9). Leaving ends the game for the others,
   * unless the player resigned first (Quit Game, `disconnect_multiplayer_game` sends `SendIResignMsg`): then the game
   * goes on for them, the server filling its batches.
   */
  disconnect(peer: Peer, dropped = false): void {
    const room = this.byPeer.get(peer);
    if (!room) return;
    this.byPeer.delete(peer);
    const slot = room.members.findIndex((m) => m.peer === peer);
    if (room.started && dropped) return this.away(room, room.members[slot]!);
    const member = room.members[slot]!;
    if (room.started && member.resigned && room.members.some((m) => m !== member && m.peer !== null)) {
      member.peer = null;
      member.dropped = true;
      this.release(room);
      return;
    }
    room.members.splice(slot, 1);
    if (room.started) {
      room.broadcast({ t: 'ended', reason: 'peer-left' });
      this.closeRoom(room);
      return;
    }
    if (room.members.length === 0) {
      this.rooms.delete(room.code);
      return;
    }
    for (const m of room.members) m.ready = false;
    room.sendLobby();
  }

  private closeRoom(room: Room): void {
    for (const m of room.members) {
      if (m.peer) this.byPeer.delete(m.peer);
      m.cancelDrop?.();
      m.cancelDrop = null;
    }
    this.rooms.delete(room.code);
  }

  /** `member`'s socket broke: hold its slot, and drop it once it stayed away `DROP_AFTER_MS`. */
  private away(room: Room, member: Member): void {
    member.peer = null;
    const wait = Math.max(0, DROP_AFTER_MS - (this.now() - member.heardAt));
    member.cancelDrop = this.schedule(() => this.drop(room, member), wait);
  }

  /**
   * Drop `member` from the game as the original's host does with a player that stopped answering (`Kick`, then every
   * other player runs `command_resign(player, 1)` on `COMM_OTHER_PLAYER_DROPPED`): its next batch resigns it, and from
   * then on the server fills its batches. A room with nobody connected left is closed.
   */
  private drop(room: Room, member: Member): void {
    member.cancelDrop = null;
    if (this.rooms.get(room.code) !== room) return;
    if (room.members.every((m) => m.peer === null)) return this.closeRoom(room);
    member.dropped = true;
    room.broadcast({ t: 'dropped', slot: room.members.indexOf(member) });
    member.pending.set(member.nextTurn, [{ type: 'resign' }]);
    member.nextTurn++;
    this.release(room);
  }

  /** Give a dropped socket's slot back to its client (`rejoin`): the turns it missed follow `rejoined`. */
  private rejoin(peer: Peer, rawCode: string, slot: number, token: string, received: number): void {
    if (this.byPeer.has(peer)) return reject(peer, 'already-in-room', 'leave the current room first');
    const code = normalizeCode(rawCode);
    const room = isValidCode(code) ? this.rooms.get(code) : undefined;
    const member = room?.started ? room.members[slot] : undefined;
    if (!room || !member || member.dropped || member.token !== token || received > room.log.length) {
      return reject(peer, 'bad-rejoin', 'cannot rejoin that game');
    }
    // A socket that broke without the server noticing yet loses the slot to the new one.
    if (member.peer) this.byPeer.delete(member.peer);
    member.cancelDrop?.();
    member.cancelDrop = null;
    member.peer = peer;
    member.heardAt = this.now();
    this.byPeer.set(peer, room);
    peer.send({ t: 'rejoined', nextTurn: member.nextTurn });
    for (const record of room.log.slice(received)) peer.send({ t: 'turn', ...record });
    peer.send({ t: 'rtt', rtt: room.members.map((m) => m.rtt) });
    this.ping(member, true);
  }

  private newMember(peer: Peer, name: string, slot: number): Member {
    return {
      peer,
      name: name === '' ? `Player ${slot + 1}` : name,
      ready: false,
      nextTurn: 0,
      pending: new Map(),
      hashes: new Map(),
      rtt: 0,
      frameMs: 0,
      pingN: 0,
      pingAt: 0,
      token: '',
      heardAt: this.now(),
      dropped: false,
      cancelDrop: null,
      resigned: false,
    };
  }

  private create(peer: Peer, name: string): void {
    if (this.byPeer.has(peer)) return reject(peer, 'already-in-room', 'leave the current room first');
    let code = this.generateCode();
    while (this.rooms.has(code)) code = this.generateCode();
    const room = new Room(code);
    room.members.push(this.newMember(peer, name, 0));
    this.rooms.set(code, room);
    this.byPeer.set(peer, room);
    room.sendLobby();
  }

  private join(peer: Peer, rawCode: string, name: string): void {
    if (this.byPeer.has(peer)) return reject(peer, 'already-in-room', 'leave the current room first');
    const code = normalizeCode(rawCode);
    const room = isValidCode(code) ? this.rooms.get(code) : undefined;
    if (!room) return reject(peer, 'bad-code', 'no room with that invite code');
    if (room.started) return reject(peer, 'room-started', 'game already started');
    if (room.members.length >= MAX_PLAYERS) return reject(peer, 'room-full', 'room is full');
    for (const m of room.members) m.ready = false;
    room.members.push(this.newMember(peer, name, room.members.length));
    this.byPeer.set(peer, room);
    room.sendLobby();
  }

  private start(room: Room, slot: number, peer: Peer): void {
    if (room.started) return reject(peer, 'room-started', 'game already started');
    if (slot !== 0) return reject(peer, 'not-host', 'only the host can start');
    if (room.members.length < MAX_PLAYERS || room.members.some((m) => !m.ready)) {
      return reject(peer, 'not-ready', 'every player must be ready');
    }
    room.started = true;
    room.seed = this.generateSeed();
    const players = room.players();
    for (const m of room.members) {
      m.token = this.generateToken();
      m.peer?.send({ t: 'start', seed: room.seed, commandDelay: COMMAND_DELAY_TURNS, players, token: m.token });
    }
    for (const m of room.members) this.ping(m, true);
  }

  /** Ping `member` when forced or when `PING_INTERVAL_MS` passed since the last ping (`CheckPingTime`). */
  private ping(member: Member, force: boolean): void {
    const now = this.now();
    if (!force && now - member.pingAt <= PING_INTERVAL_MS) return;
    if (!member.peer) return;
    member.pingN++;
    member.pingAt = now;
    member.peer.send({ t: 'ping', n: member.pingN });
  }

  private pong(room: Room, member: Member, n: number): void {
    if (n !== member.pingN) return;
    member.rtt = Math.max(0, Math.round(this.now() - member.pingAt));
    room.broadcast({ t: 'rtt', rtt: room.members.map((m) => m.rtt) });
  }

  private submitTurn(room: Room, member: Member, peer: Peer, turn: number, commands: Command[]): void {
    if (!room.started) return reject(peer, 'not-started', 'game has not started');
    if (turn !== member.nextTurn) {
      return reject(peer, 'bad-turn', `expected turn ${member.nextTurn}, got ${turn}`);
    }
    if (turn - room.log.length >= MAX_TURNS_AHEAD) {
      return reject(peer, 'bad-turn', 'too many unreleased turns');
    }
    member.pending.set(turn, commands);
    member.nextTurn++;
    if (commands.some((c) => c.type === 'resign')) member.resigned = true;
    this.release(room);
  }

  /**
   * Release every turn for which all members have submitted, in order. Once turn N is released every member has run
   * it, which is the host's boundary N + 1: the speed analysis runs there, and its change rides on this release.
   */
  private release(room: Room): void {
    for (;;) {
      const turn = room.log.length;
      if (room.members.some((m) => !m.dropped && !m.pending.has(turn))) return;
      const batches = room.members.map((m, slot) => ({ slot, commands: m.pending.get(turn) ?? [] }));
      for (const m of room.members) m.pending.delete(turn);
      // Through the relay a round trip between players is the sum of both legs (turn-timing.md §8.3).
      const latency = highLatencyMs(room.members.reduce((sum, m) => sum + m.rtt, 0));
      const frameMs = Math.max(...room.members.map((m) => m.frameMs));
      const speed = room.speed.boundary(turn + 1, frameMs, latency);
      const record: TurnRecord = speed ? { turn, batches, speed } : { turn, batches };
      room.log.push(record);
      room.broadcast({ t: 'turn', ...record });
    }
  }

  private reportHash(room: Room, member: Member, peer: Peer, turn: number, hash: number): void {
    if (!room.started) return reject(peer, 'not-started', 'game has not started');
    if (turn >= room.log.length) return reject(peer, 'bad-turn', 'turn not released yet');
    member.hashes.set(turn, hash);
    if (room.members.some((m) => !m.dropped && !m.hashes.has(turn))) return;
    const hashes = room.members.map((m) => m.hashes.get(turn) ?? 0);
    for (const m of room.members) m.hashes.delete(turn);
    const reported = hashes.filter((_, slot) => !room.members[slot]!.dropped);
    if (reported.some((h) => h !== reported[0])) {
      room.desyncs.push(turn);
      room.broadcast({ t: 'desync', turn, hashes });
    }
  }
}

function reject(peer: Peer, code: ErrorCode, message: string): void {
  peer.send({ t: 'error', code, message });
}
