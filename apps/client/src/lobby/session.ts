import type { ErrorCode, GameSettings, PlayerInfo, ServerMessage, Slot } from '@aoe/protocol';
import { DEFAULT_GAME_SETTINGS, normalizeCode } from '@aoe/protocol';
import type { Link } from '../net/link';

export type StartMessage = Extract<ServerMessage, { t: 'start' }>;

export interface LobbyState {
  phase: 'idle' | 'lobby' | 'playing' | 'ended';
  code: string;
  /** This client's slot; -1 before joining. */
  you: Slot;
  players: PlayerInfo[];
  /** The host's map type, map size and victory condition, as the server last sent them. */
  settings: GameSettings;
  /** Last error from the server (bad code, room full, ...), cleared by the next action. */
  error: { code: ErrorCode | 'connection'; message: string } | null;
}

const sameJson = (a: unknown, b: unknown): boolean => {
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return a === b;
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => sameJson((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
};

/** Lobby logic over a link, no DOM: create/join by code, ready, host start. Gameplay messages belong to lockstep. */
export class Session {
  /** Settings sent whose echo has not come back, oldest first; while any is pending the shown settings are the local ones. */
  private pendingSettings: GameSettings[] = [];
  state: LobbyState = { phase: 'idle', code: '', you: -1, players: [], settings: DEFAULT_GAME_SETTINGS, error: null };
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

  /** Host only, while not ready: the game's settings (docs/spec/lobby.md §4). */
  setSettings(settings: GameSettings): void {
    // Shown at once, so the next change builds on it; the echoes of the settings still pending are older and ignored.
    this.pendingSettings.push(settings);
    this.set({ error: null, settings });
    this.link.send({ t: 'settings', settings });
  }

  /** This player's civilization, while not ready. */
  setCiv(civ: number): void {
    this.set({ error: null });
    this.link.send({ t: 'civ', civ });
  }

  start(): void {
    this.set({ error: null });
    this.link.send({ t: 'start' });
  }

  /** Leave the room (or the game) and return to the entry screen. */
  leave(): void {
    this.link.send({ t: 'leave' });
    this.pendingSettings = [];
    this.set({ phase: 'idle', code: '', you: -1, players: [], error: null });
  }

  /** The game is over (opponent left, desync): leave the room and show the entry screen. */
  finish(): void {
    this.link.send({ t: 'leave' });
    this.set({ phase: 'ended' });
  }

  private handle(m: ServerMessage): void {
    switch (m.t) {
      case 'lobby': {
        // An echo carrying a pending settings object answers it and every older one; others (a guest's ready or civ) change nothing here.
        const answered = this.pendingSettings.findIndex((p) => sameJson(p, m.settings));
        if (answered >= 0) this.pendingSettings.splice(0, answered + 1);
        this.set({ phase: 'lobby', code: m.code, you: m.you, players: m.players, error: null, ...(this.pendingSettings.length === 0 && { settings: m.settings }) });
        return;
      }
      case 'start':
        this.set({ phase: 'playing', players: m.players, settings: m.settings });
        this.onStart(m, this.state.you);
        return;
      case 'error':
        this.pendingSettings = [];
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
