import { randomInt } from 'node:crypto';
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  COMMAND_DELAY_TURNS,
  MAX_PLAYERS,
  MAX_TURNS_AHEAD,
  TURN_MS,
  isValidCode,
  normalizeCode,
  type ClientMessage,
  type Command,
  type ErrorCode,
  type PlayerInfo,
  type ServerMessage,
  type TurnBatch,
} from '@aoe/protocol';

/** One connected client, as the room logic sees it. */
export interface Peer {
  send(message: ServerMessage): void;
}

/** One released turn, as sent to both clients. */
export interface TurnRecord {
  turn: number;
  batches: TurnBatch[];
}

interface Member {
  peer: Peer;
  name: string;
  ready: boolean;
  /** Next turn this member must submit. */
  nextTurn: number;
  /** Submitted but not yet released batches. */
  pending: Map<number, Command[]>;
  hashes: Map<number, number>;
}

export class Room {
  readonly members: Member[] = [];
  /** Every turn released so far, in order. */
  readonly log: TurnRecord[] = [];
  readonly desyncs: number[] = [];
  started = false;
  seed = 0;

  constructor(readonly code: string) {}

  players(): PlayerInfo[] {
    return this.members.map((m, slot) => ({ slot, name: m.name, ready: m.ready }));
  }

  broadcast(message: ServerMessage): void {
    for (const m of this.members) m.peer.send(message);
  }

  sendLobby(): void {
    const players = this.players();
    this.members.forEach((m, you) => m.peer.send({ t: 'lobby', code: this.code, you, players }));
  }
}

export interface RoomRegistryOptions {
  /** Override code generation (tests). Must return a normalized, valid code. */
  generateCode?: () => string;
  /** Override the game seed (tests). */
  generateSeed?: () => number;
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

  constructor(options: RoomRegistryOptions = {}) {
    this.generateCode = options.generateCode ?? randomCode;
    this.generateSeed = options.generateSeed ?? (() => randomInt(2 ** 32));
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
    switch (message.t) {
      case 'ready':
        if (room.started) return reject(peer, 'room-started', 'game already started');
        member.ready = message.ready;
        return room.sendLobby();
      case 'start':
        return this.start(room, slot, peer);
      case 'turn':
        return this.submitTurn(room, member, peer, message.turn, message.commands);
      case 'hash':
        return this.reportHash(room, member, peer, message.turn, message.hash);
    }
  }

  /** Remove a peer from its room (leave message or dropped socket). */
  disconnect(peer: Peer): void {
    const room = this.byPeer.get(peer);
    if (!room) return;
    this.byPeer.delete(peer);
    const slot = room.members.findIndex((m) => m.peer === peer);
    room.members.splice(slot, 1);
    if (room.started) {
      // No reconnection yet: a started game ends when anyone leaves.
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
    for (const m of room.members) this.byPeer.delete(m.peer);
    this.rooms.delete(room.code);
  }

  private newMember(peer: Peer, name: string, slot: number): Member {
    return {
      peer,
      name: name === '' ? `Player ${slot + 1}` : name,
      ready: false,
      nextTurn: 0,
      pending: new Map(),
      hashes: new Map(),
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
    room.broadcast({
      t: 'start',
      seed: room.seed,
      turnMs: TURN_MS,
      commandDelay: COMMAND_DELAY_TURNS,
      players: room.players(),
    });
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
    this.release(room);
  }

  /** Release every turn for which all members have submitted, in order. */
  private release(room: Room): void {
    for (;;) {
      const turn = room.log.length;
      if (room.members.some((m) => !m.pending.has(turn))) return;
      const batches = room.members.map((m, slot) => ({ slot, commands: m.pending.get(turn) ?? [] }));
      for (const m of room.members) m.pending.delete(turn);
      room.log.push({ turn, batches });
      room.broadcast({ t: 'turn', turn, batches });
    }
  }

  private reportHash(room: Room, member: Member, peer: Peer, turn: number, hash: number): void {
    if (!room.started) return reject(peer, 'not-started', 'game has not started');
    if (turn >= room.log.length) return reject(peer, 'bad-turn', 'turn not released yet');
    member.hashes.set(turn, hash);
    if (room.members.some((m) => !m.hashes.has(turn))) return;
    const hashes = room.members.map((m) => m.hashes.get(turn) ?? 0);
    for (const m of room.members) m.hashes.delete(turn);
    if (hashes.some((h) => h !== hashes[0])) {
      room.desyncs.push(turn);
      room.broadcast({ t: 'desync', turn, hashes });
    }
  }
}

function reject(peer: Peer, code: ErrorCode, message: string): void {
  peer.send({ t: 'error', code, message });
}
