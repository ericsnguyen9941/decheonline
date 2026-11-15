import {
  CIV_RANDOM,
  DEFAULT_SCORE_LIMIT,
  DEFAULT_TIME_LIMIT,
  LOBBY_MAP_SIZES,
  LOBBY_MAP_TYPES,
  LOBBY_POPULATION_LIMITS,
  LOBBY_SCORE_LIMITS,
  LOBBY_TIME_LIMITS,
  LOBBY_VICTORY_TYPES,
  VICTORY_SCORE,
  VICTORY_TIME_LIMIT,
  type GameSettings,
} from '@aoe/sim';
import type { LobbyState } from './session';
import type { Session } from './session';
import { civName, englishText, LABELS, mapSizeName, mapTypeName, summaryLines, timeLimitName, victoryName, type Text } from './setting-text';

const ERROR_TEXT: Record<string, string> = {
  'bad-code': 'No game with that invite code.',
  'room-full': 'That game is full.',
  'room-started': 'That game has already started.',
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { testid?: string } = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const { testid, ...rest } = props;
  const node = Object.assign(document.createElement(tag), rest);
  if (testid) node.dataset.testid = testid;
  node.append(...children);
  return node;
}

/** A drop-down of `options` ([value, label]) showing `value`; `onPick` gets the picked value. */
function select(testid: string, label: string, options: [number, string][], value: number, onPick: (v: number) => void): HTMLSelectElement {
  const node = el('select', { ariaLabel: label, testid });
  for (const [v, text] of options) node.append(el('option', { value: String(v), selected: v === value }, text));
  node.addEventListener('change', () => onPick(Number(node.value)));
  return node;
}

/** The setup screen's chat box keeps 100 lines (`fillChat`, src/scr_mps.cpp:1704-1716). */
const CHAT_LINES = 100;
/** Its input takes 247 characters (`create_edit(..., 247, ...)`, src/scr_mps.cpp:235). */
const CHAT_LENGTH = 247;

/**
 * DOM for the lobby: entry (name, create, join by code) and the room (invite code, players with their civs, the host's
 * settings, chat, ready, start), as the original's multiplayer setup screen offers them (docs/spec/lobby.md,
 * docs/spec/chat.md §5).
 */
export class LobbyView {
  readonly root = el('section', { id: 'lobby', testid: 'lobby' });
  private name = 'Player';
  private text: Text = englishText;
  /** The room's chat, kept across redraws: the box of lines and the input. */
  private readonly chatLog = el('div', { className: 'chat-log', testid: 'lobby-chat' });
  private readonly chatInput = el('input', { maxLength: CHAT_LENGTH, testid: 'lobby-chat-input', ariaLabel: 'Chat', autocomplete: 'off' });
  private readonly chatTitle = el('h3', {});
  private readonly chat = el('div', { className: 'chat' }, this.chatTitle, this.chatLog, this.chatInput);
  private inRoom = false;

  constructor(private readonly session: Session) {
    session.onChange = (state) => this.render(state);
    session.onChat = (line) => this.addChat(line);
    this.chatInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || !this.chatInput.value) return;
      this.session.sendChat(this.chatInput.value);
      this.chatInput.value = '';
    });
    this.render(session.state);
  }

  /**
   * Use the pack's language strings from the next redraw on (the next lobby message). Not redrawn now: a redraw at an
   * arbitrary moment swaps the input or button the player is using. The English fallbacks are the retail strings.
   */
  setText(text: Text): void {
    this.text = text;
  }

  render(state: LobbyState): void {
    this.root.hidden = state.phase === 'playing';
    // A new setup screen starts with an empty chat (`chat->ClearChat()`, src/scr_mps.cpp:52).
    if (state.phase === 'lobby' && !this.inRoom) this.chatLog.replaceChildren();
    this.inRoom = state.phase === 'lobby';
    // The chat moves into the new panel; typing in it goes on.
    const typing = document.activeElement === this.chatInput;
    this.root.replaceChildren(state.phase === 'lobby' ? this.room(state) : this.entry(state));
    if (typing && this.chatInput.isConnected) this.chatInput.focus();
  }

  /** `word_wrap_append` a line; the box follows the newest line when it was showing the last one. */
  private addChat(line: string): void {
    const log = this.chatLog;
    const atEnd = log.scrollTop + log.clientHeight >= log.scrollHeight - 1;
    if (log.childElementCount >= CHAT_LINES) log.firstElementChild?.remove();
    log.append(el('div', { className: 'chat-line', testid: 'lobby-chat-line' }, line));
    if (atEnd) log.scrollTop = log.scrollHeight;
  }

  private entry(state: LobbyState): HTMLElement {
    const name = el('input', { value: this.name, maxLength: 24, testid: 'name', ariaLabel: 'Your name', placeholder: 'Your name' });
    name.addEventListener('input', () => (this.name = name.value.trim() || 'Player'));
    const code = el('input', { maxLength: 12, placeholder: 'Invite code', testid: 'code', ariaLabel: 'Invite code' });
    const create = el('button', { testid: 'create', className: 'primary' }, 'Create game');
    create.addEventListener('click', () => this.session.create(this.name));
    const join = el('button', { testid: 'join' }, 'Join game');
    join.addEventListener('click', () => this.session.join(code.value, this.name));
    const box = el(
      'div',
      { className: 'panel' },
      el('h2', {}, 'Multiplayer'),
      el('label', {}, 'Your name', name),
      el('div', { className: 'row' }, create),
      el('p', { className: 'or' }, 'or join a friend with their invite code'),
      el('div', { className: 'row' }, code, join),
    );
    if (state.phase === 'ended') box.append(el('p', { className: 'note', testid: 'ended' }, 'The game ended.'));
    this.appendError(box, state);
    return box;
  }

  private room(state: LobbyState): HTMLElement {
    const me = state.players.find((p) => p.slot === state.you);
    const host = state.you === 0;
    const everyoneReady = state.players.length === 2 && state.players.every((p) => p.ready);
    const list = el('ul', { testid: 'players', className: 'players' });
    for (const p of state.players) {
      // Each player picks its own civ while it is not ready (`TribeMPSetupScreen::fillPlayers`); the other's is text.
      const civ =
        p.slot === state.you && !p.ready
          ? select(`civ-${p.slot}`, this.label('civ'), this.civOptions(), p.civ, (c) => this.session.setCiv(c))
          : el('span', { className: 'civ', testid: `civ-${p.slot}` }, civName(this.text, p.civ));
      list.append(el('li', { testid: `player-${p.slot}` }, `${p.name}${p.slot === 0 ? ' (host)' : ''} - ${p.ready ? 'ready' : 'not ready'} `, civ));
    }
    if (state.players.length < 2) list.append(el('li', {}, 'Waiting for a second player...'));
    const ready = el('button', { testid: 'ready', className: 'primary' }, me?.ready ? 'Not ready' : 'Ready');
    ready.addEventListener('click', () => this.session.setReady(!me?.ready));
    const leave = el('button', { testid: 'leave' }, 'Leave');
    leave.addEventListener('click', () => this.session.leave());
    const box = el(
      'div',
      { className: 'panel' },
      el('h2', {}, 'Game lobby'),
      el('p', { className: 'invite' }, 'Invite code ', el('strong', { testid: 'invite-code' }, state.code)),
      list,
      this.settings(state.settings, host && !me?.ready),
      this.chatPanel(),
      el('div', { className: 'row' }, ready, leave),
    );
    if (host) {
      const start = el('button', { testid: 'start', className: 'primary', disabled: !everyoneReady }, 'Start game');
      start.addEventListener('click', () => this.session.start());
      box.append(el('div', { className: 'row' }, start));
    }
    this.appendError(box, state);
    return box;
  }

  private chatPanel(): HTMLElement {
    this.chatTitle.textContent = this.label('chat');
    return this.chat;
  }

  private label(key: keyof typeof LABELS): string {
    const [id, fallback] = LABELS[key];
    return this.text(id, fallback);
  }

  private civOptions(): [number, string][] {
    return Array.from({ length: CIV_RANDOM }, (_, i) => [i + 1, civName(this.text, i + 1)]);
  }

  /**
   * The host, while not ready, picks the map size, map type, victory condition and population limit (the Game Settings
   * screen, src/scr_set.cpp); otherwise the setup screen's summary of them.
   */
  private settings(s: GameSettings, editable: boolean): HTMLElement {
    const box = el('div', { className: 'settings', testid: 'settings' }, el('h3', {}, this.label('settings')));
    if (!editable) {
      box.append(el('ul', { testid: 'settings-summary' }, ...summaryLines(this.text, s).map((line) => el('li', {}, line))));
      return box;
    }
    const change = (patch: Partial<GameSettings>) => this.session.setSettings({ ...this.session.state.settings, ...patch });
    const field = (key: keyof typeof LABELS, control: HTMLElement) => el('label', {}, this.label(key), control);
    box.append(
      field('mapSize', select('map-size', this.label('mapSize'), LOBBY_MAP_SIZES.map((v) => [v, mapSizeName(this.text, v)]), s.mapSize, (mapSize) => change({ mapSize }))),
      field('mapType', select('map-type', this.label('mapType'), LOBBY_MAP_TYPES.map((v) => [v, mapTypeName(this.text, v)]), s.mapType, (mapType) => change({ mapType }))),
      field(
        'victory',
        select('victory', this.label('victory'), LOBBY_VICTORY_TYPES.map((v) => [v, victoryName(this.text, v)]), s.victory.type, (type) =>
          // Picking Time Limit or Score selects its default line (`TribeGameSettingsScreen::action`).
          change({ victory: type === VICTORY_TIME_LIMIT ? { type, amount: DEFAULT_TIME_LIMIT } : type === VICTORY_SCORE ? { type, amount: DEFAULT_SCORE_LIMIT } : { type } }),
        ),
      ),
    );
    const { type, amount } = s.victory;
    if (type === VICTORY_TIME_LIMIT || type === VICTORY_SCORE) {
      const options: [number, string][] =
        type === VICTORY_TIME_LIMIT ? LOBBY_TIME_LIMITS.map((v) => [v, timeLimitName(this.text, v)]) : LOBBY_SCORE_LIMITS.map((v) => [v, String(v)]);
      const pick = select('victory-amount', this.label(type === VICTORY_TIME_LIMIT ? 'timeLimit' : 'score'), options, amount ?? 0, (a) => change({ victory: { type, amount: a } }));
      box.append(field(type === VICTORY_TIME_LIMIT ? 'timeLimit' : 'score', pick));
    }
    // The dialog's numbers, "25" .. "200" (scr_set.cpp:189-192).
    const limits: [number, string][] = LOBBY_POPULATION_LIMITS.map((v) => [v, String(v)]);
    box.append(field('populationLimit', select('population-limit', this.label('populationLimit'), limits, s.populationLimit, (populationLimit) => change({ populationLimit }))));
    return box;
  }

  private appendError(box: HTMLElement, state: LobbyState): void {
    if (!state.error) return;
    const text = ERROR_TEXT[state.error.code] ?? state.error.message;
    box.append(el('p', { role: 'alert', className: 'error', testid: 'error' }, text));
  }
}
