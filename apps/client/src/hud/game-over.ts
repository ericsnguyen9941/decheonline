// The end of a game on the game screen (`TRIBE_Screen_Game::handle_idle`, src/scr_game.cpp:1190-1265) and the system
// messages on the chat lines (`display_system_message`, `TRIBE_Game::notification`, src/tribegam.cpp:1818-1856).
import { STATUS_LOST, STATUS_WON, type World } from '@aoe/sim';
import type { AssetProvider } from '../assets';
import { FONT, placed, textColours } from './easy-panel';

/** `STRING_ID_VICTORY_MESSAGE`, `_DEFEAT_MESSAGE`, `_GAME_OVER_MESSAGE`. */
const VICTORY_MESSAGE = 0x232c;
const DEFEAT_MESSAGE = 0x232d;
const GAME_OVER_MESSAGE = 0x232e;
/** `STRING_ID_MESSAGE_PLAYER_DISCONNECTED`, `_RESIGNED`, `_DEFEATED`, `STRING_ID_ERROR_COMMUNICATION`: "%s ...". */
export const MESSAGE_DISCONNECTED = 0xbc4;
const MESSAGE_RESIGNED = 0xbc5;
const MESSAGE_DEFEATED = 0xbc6;
export const MESSAGE_NOT_RESPONDING = 0x4c1;
/** `won.wav`, `lost.wav` (interfac.drs 50320, 50321). */
const WAV_WON = 50320;
const WAV_LOST = 50321;
/** `TRIBE_Game::sounds`: chat received, player killed. */
export const SOUND_CHAT = 2;
const SOUND_PLAYER_KILLED = 6;
/** The victory or defeat text shows this long before a multiplayer game's map is shown in full. */
const GAME_OVER_MS = 5000;
/** Chat lines: 8 of 620 x 20 from (4, 34) of the main view, used in turn; a message stays 8 s. */
const CHAT_LINES = 8;
const CHAT_MS = 8000;

/** The sounds the end of the game and the messages play. */
export interface GameOverSounds {
  /** `play_sound(index)`: one of the game's own sounds. */
  message(index: number): void;
  /** won.wav or lost.wav, from its start. */
  gameOver(id: number): void;
}

/** `sprintf(get_string(id), name)`. */
export function formatName(provider: AssetProvider, id: number, name: string): string {
  return (provider.string(id) ?? '').replace('%s', name);
}

/** The chat lines over the main view (`chat_panel[0..7]`): `display_system_message` writes the next one. */
export class ChatLines {
  private readonly lines: HTMLDivElement[];
  private next = 0;
  private readonly timers = new Map<HTMLDivElement, ReturnType<typeof setTimeout>>();

  constructor(view: HTMLElement) {
    this.lines = Array.from({ length: CHAT_LINES }, (_, i) => {
      const el = placed(view, 'div', `aoe-text ${FONT.standard}`, 4, 34 + 20 * i, 620, 20);
      el.dataset.testid = 'chat-line';
      textColours(el, ['#ffffff', '#000000']);
      return el;
    });
  }

  show(text: string): void {
    const el = this.lines[this.next]!;
    this.next = (this.next + 1) % CHAT_LINES;
    el.textContent = text;
    clearTimeout(this.timers.get(el));
    this.timers.set(
      el,
      setTimeout(() => (el.textContent = ''), CHAT_MS),
    );
  }

  /** Every line's text, oldest first (for the tests). */
  get texts(): string[] {
    return [...this.lines.slice(this.next), ...this.lines.slice(0, this.next)].flatMap((el) => (el.textContent ? [el.textContent] : []));
  }

  destroy(): void {
    for (const t of this.timers.values()) clearTimeout(t);
  }
}

export interface GameOverOptions {
  /** The main view's box (between the top strip and the bottom panel). */
  view: HTMLElement;
  provider: AssetProvider;
  world: World;
  player: number;
  /** Player names by player number. */
  names: readonly string[];
  sounds: GameOverSounds | null;
  chat: ChatLines;
  /** `player_quit`: the player resigned from the menu. */
  quit(): boolean;
  /** Is player `p` dropped by the server (its resign is a disconnection)? */
  dropped(p: number): boolean;
  /** Entering the game over mode: cancel the order being given and unselect. */
  onGameOver(): void;
  /** Multiplayer, 5 s later: the whole map, no fog. */
  reveal(): void;
}

/**
 * Watches the world after each step: another player's resignation or defeat on the chat lines with the player killed
 * sound (the original's notifications for others only), then the game over mode once the game is over, this player
 * lost or resigned: the victory or defeat text over the view with won.wav or lost.wav, and in a multiplayer game 5 s
 * later the whole map without fog and "Game over. Click Menu/Quit Game to exit." at the top.
 */
export class GameOver {
  private readonly pauseText: HTMLDivElement;
  private readonly quitMessage: HTMLDivElement;
  private status: number[];
  private overAt: number | null = null;
  private revealed = false;

  constructor(private readonly o: GameOverOptions) {
    this.status = [...o.world.victory.status];
    // `pause_text`: 600 x 60, centred; `quit_message_panel`: (width - 500) / 2 from each side, 8 from the top, 20 high.
    this.pauseText = placed(o.view, 'div', `aoe-text ${FONT.copper21}`, 0, 0, 600, 60);
    Object.assign(this.pauseText.style, { left: 'calc(50% - 300px)', top: 'calc(50% - 30px)', display: 'flex', alignItems: 'center', justifyContent: 'center' });
    this.pauseText.dataset.testid = 'game-over-text';
    this.quitMessage = placed(o.view, 'div', `aoe-text ${FONT.standard}`, 0, 8, 500, 20);
    Object.assign(this.quitMessage.style, { left: 'calc(50% - 250px)', textAlign: 'center' });
    this.quitMessage.dataset.testid = 'game-over-message';
    for (const el of [this.pauseText, this.quitMessage]) {
      el.hidden = true;
      textColours(el, ['#ffffff', '#000000']);
    }
    this.quitMessage.textContent = o.provider.string(GAME_OVER_MESSAGE) ?? '';
  }

  /** Is the game screen in the game over mode? */
  get over(): boolean {
    return this.overAt !== null;
  }

  update(now = performance.now()): void {
    const { world, player, provider, sounds } = this.o;
    for (let p = 1; p < world.players; p++) {
      const before = this.status[p];
      const after = world.victory.status[p]!;
      this.status[p] = after;
      if (p === player || before === after || after !== STATUS_LOST) continue;
      // `do_resign` notifies "resigned" (dropped: "disconnected"); `set_game_status(2)` otherwise "defeated".
      const id = world.victory.resigned[p] ? (this.o.dropped(p) ? MESSAGE_DISCONNECTED : MESSAGE_RESIGNED) : MESSAGE_DEFEATED;
      sounds?.message(SOUND_PLAYER_KILLED);
      this.o.chat.show(formatName(provider, id, this.o.names[p] ?? ''));
    }
    if (this.overAt === null) {
      if (!world.gameOver && world.playerStatus(player) !== STATUS_LOST && !this.o.quit()) return;
      this.overAt = now;
      this.o.onGameOver();
      const won = world.playerStatus(player) === STATUS_WON;
      this.pauseText.textContent = provider.string(won ? VICTORY_MESSAGE : DEFEAT_MESSAGE) ?? '';
      this.pauseText.hidden = false;
      sounds?.gameOver(won ? WAV_WON : WAV_LOST);
    } else if (!this.revealed && now - this.overAt > GAME_OVER_MS) {
      this.revealed = true;
      this.pauseText.hidden = true;
      this.quitMessage.hidden = false;
      this.o.reveal();
    }
  }
}
