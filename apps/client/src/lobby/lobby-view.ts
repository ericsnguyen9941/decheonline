import type { LobbyState } from './session';
import type { Session } from './session';

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

/** DOM for the lobby: entry (name, create, join by code) and the room (invite code, players, ready, start). */
export class LobbyView {
  readonly root = el('section', { id: 'lobby', testid: 'lobby' });
  private name = 'Player';

  constructor(private readonly session: Session) {
    session.onChange = (state) => this.render(state);
    this.render(session.state);
  }

  render(state: LobbyState): void {
    this.root.hidden = state.phase === 'playing';
    this.root.replaceChildren(state.phase === 'lobby' ? this.room(state) : this.entry(state));
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
      list.append(el('li', { testid: `player-${p.slot}` }, `${p.name}${p.slot === 0 ? ' (host)' : ''} - ${p.ready ? 'ready' : 'not ready'}`));
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

  private appendError(box: HTMLElement, state: LobbyState): void {
    if (!state.error) return;
    const text = ERROR_TEXT[state.error.code] ?? state.error.message;
    box.append(el('p', { role: 'alert', className: 'error', testid: 'error' }, text));
  }
}
