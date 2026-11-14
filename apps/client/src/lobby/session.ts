import type { ErrorCode, PlayerInfo, ServerMessage, Slot } from '@aoe/protocol';
import { normalizeCode } from '@aoe/protocol';
import type { Link } from '../net/link';

export type StartMessage = Extract<ServerMessage, { t: 'start' }>;

export interface LobbyState {
  phase: 'idle' | 'lobby' | 'playing' | 'ended';
  code: string;
  /** This client's slot; -1 before joining. */
  you: Slot;
  players: PlayerInfo[];
  /** Last error from the server (bad code, room full, ...), cleared by the next action. */
  error: { code: ErrorCode | 'connection'; message: string } | null;
}

/** Lobby logic over a link, no DOM: create/join by code, ready, host start. Gameplay messages belong to lockstep. */
export class Session {
  state: LobbyState = { phase: 'idle', code: '', you: -1, players: [], error: null };
  /** Called after every state change. */
  onChange: (state: LobbyState) => void = () => {};
  /** Called when the host starts the game. */
  onStart: (start: StartMessage, you: Slot) => void = () => {};

  constructor(private readonly link: Link) {
    link.onMessage((m) => this.handle(m));
    link.onClose(() => {
      if (this.state.phase === 'playing') return; // lockstep reports this as the opponent leaving
      this.set({ phase: 'idle', error: { code: 'connection', message: 'Connection to the server was lost.' } });
    });
  }

  create(name: string): void {
    this.set({ error: null });
    this.link.send({ t: 'create', name });
  }

  join(code: string, name: string): void {
    this.set({ error: null });
    this.link.send({ t: 'join', code: normalizeCode(code), name });
  }

  setReady(ready: boolean): void {
    this.link.send({ t: 'ready', ready });
  }

  start(): void {
    this.set({ error: null });
    this.link.send({ t: 'start' });
  }

  /** Leave the room (or the game) and return to the entry screen. */
  leave(): void {
    this.link.send({ t: 'leave' });
    this.set({ phase: 'idle', code: '', you: -1, players: [], error: null });
  }

  /** The game is over (opponent left, desync): leave the room and show the entry screen. */
  finish(): void {
    this.link.send({ t: 'leave' });
    this.set({ phase: 'ended' });
  }

  private handle(m: ServerMessage): void {
    switch (m.t) {
      case 'lobby':
        this.set({ phase: 'lobby', code: m.code, you: m.you, players: m.players, error: null });
        return;
      case 'start':
        this.set({ phase: 'playing', players: m.players });
        this.onStart(m, this.state.you);
        return;
      case 'error':
        this.set({ error: { code: m.code, message: m.message } });
        return;
      default:
        return;
    }
  }

  private set(patch: Partial<LobbyState>): void {
    this.state = { ...this.state, ...patch };
    this.onChange(this.state);
  }
}
