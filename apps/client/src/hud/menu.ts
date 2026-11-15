// The Menu button's dialog (`TribeMenuDialog`, src/dlg_menu.cpp) and the game screen's yes/no and OK popups
// (`TEasy_Panel::popupYesNoDialog` / `popupOKDialog`, `TMessageDialog`, src/dlg_msg.cpp), in the in-game dialogs' look
// (`dlg6_<culture>`). A multiplayer game has no Save, Load or Restart; Scenario Instructions, Help and About have no
// port and show disabled.
import type { AssetProvider } from '../assets';
import { easyButton, FONT, GAME_DIALOG_INFO, lookOf, paintPanel, placed, textColours } from './easy-panel';

/** `STRING_ID_MENU_*` (include/resource_ids.h) and the popups' `STRING_ID_BUTTON_YES`, `_NO`, `_OK`. */
const STRING = {
  quit: 0x2439,
  resign: 0x2440,
  achievements: 0x2437,
  instructions: 0x243e,
  settings: 0x243a,
  help: 0x23f5,
  about: 0x23f9,
  cancel: 0x243b,
  yes: 4003,
  no: 4004,
  ok: 4001,
} as const;
/** `STRING_ID_CONFIRM_QUIT_GAME`, `STRING_ID_CONFIRM_RESIGN`. */
export const CONFIRM_QUIT = 0xc1d;
export const CONFIRM_RESIGN = 0xc1f;

/** `TEASY_POPUP_WIDTH` x 100: every popup the menu opens. */
const POPUP = { w: 450, h: 100 };
const BUTTON = { w: 90, h: 30 };
const MENU_WIDTH = 400;
const MENU_BUTTON = { x: 20, w: 360, h: 30 };

export interface MenuActions {
  /** Does Resign show: a multiplayer game while the player's `game_status` is 0? */
  playing(): boolean;
  /** Quit Game, confirmed (`do_game_over`). */
  quit(): void;
  /** Resign, confirmed (`player_quit = 1`, `command_resign`). */
  resign(): void;
  /** Achievements: the in-game achievements screen. */
  achievements(): void;
  /** Game Settings. */
  settings(): void;
  /** A button's click sound. */
  click(): void;
}

/**
 * A modal panel over the HUD: it takes the clicks and the keys (`key_down_action` returns while
 * `panel_system.modalPanel()` is set), Esc runs `esc`.
 */
export class Modal {
  readonly cover: HTMLDivElement;
  readonly panel: HTMLDivElement;
  private readonly onKey = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape' && e.type === 'keydown') {
      e.preventDefault();
      this.esc?.();
    }
  };

  constructor(
    parent: HTMLElement,
    w: number,
    h: number,
    testid: string,
    private readonly esc: (() => void) | null,
  ) {
    this.cover = document.createElement('div');
    this.cover.className = 'aoe-modal';
    this.panel = document.createElement('div');
    this.panel.className = 'aoe-dialog';
    this.panel.dataset.testid = testid;
    Object.assign(this.panel.style, { width: `${w}px`, height: `${h}px` });
    this.cover.append(this.panel);
    this.cover.addEventListener('contextmenu', (e) => e.preventDefault());
    parent.append(this.cover);
    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('keyup', this.onKey, true);
  }

  close(): void {
    window.removeEventListener('keydown', this.onKey, true);
    window.removeEventListener('keyup', this.onKey, true);
    this.cover.remove();
  }
}

/** A popup of language string `text` (with `%s` filled in) and its buttons, in the in-game dialog look. */
function popup(parent: HTMLElement, provider: AssetProvider, text: string, buttons: { label: number; testid: string; run: () => void }[], click: () => void, esc: number): Modal {
  const look = lookOf(provider, GAME_DIALOG_INFO);
  // eslint-disable-next-line prefer-const -- the buttons' handlers close the modal they are made for
  let modal: Modal;
  const press = (run: () => void) => () => {
    modal.close();
    run();
  };
  modal = new Modal(parent, POPUP.w, POPUP.h, 'popup', press(buttons[esc]!.run));
  paintPanel(modal.panel, look);
  const t = placed(modal.panel, 'div', `aoe-text wrap ${FONT.standard}`, 3, 3, POPUP.w - 6, POPUP.h - BUTTON.h - 9);
  t.dataset.testid = 'popup-text';
  Object.assign(t.style, { display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center' });
  t.textContent = text;
  textColours(t, look.text);
  // `space = (w - n * 90) / (n + 1)`, the buttons' row 7 pixels above the bottom.
  const space = Math.trunc((POPUP.w - buttons.length * BUTTON.w) / (buttons.length + 1));
  buttons.forEach((b, i) => {
    const el = easyButton(modal.panel, look, { x: space + i * (BUTTON.w + space), y: POPUP.h - BUTTON.h - 7, ...BUTTON }, provider.string(b.label) ?? '', FONT.copper12, press(b.run), click);
    el.dataset.testid = b.testid;
  });
  return modal;
}

/** `popupYesNoDialog(text)`: Yes runs `yes`, No and Esc close it. */
export function confirmPopup(parent: HTMLElement, provider: AssetProvider, text: number, yes: () => void, click: () => void): Modal {
  const buttons = [
    { label: STRING.yes, testid: 'popup-yes', run: yes },
    { label: STRING.no, testid: 'popup-no', run: () => undefined },
  ];
  return popup(parent, provider, provider.string(text) ?? '', buttons, click, 1);
}

/** `popupOKDialog(text)`: OK and Esc close it and run `ok`. */
export function okPopup(parent: HTMLElement, provider: AssetProvider, text: string, ok: () => void, click: () => void): Modal {
  return popup(parent, provider, text, [{ label: STRING.ok, testid: 'popup-ok', run: ok }], click, 0);
}

export class MenuDialog {
  private modal: Modal | null = null;

  constructor(
    private readonly parent: HTMLElement,
    private readonly provider: AssetProvider,
    private readonly actions: MenuActions,
  ) {}

  get open(): boolean {
    return this.modal !== null;
  }

  close(): void {
    this.modal?.close();
    this.modal = null;
  }

  /** Opens the menu: 400 x 300, 335 with Resign; buttons 360 x 30 from y 15, 35 apart, Cancel 15 lower (dlg_menu.cpp:21-110). */
  show(): void {
    if (this.modal) return;
    const { parent, provider, actions } = this;
    const playing = actions.playing();
    const modal = new Modal(parent, MENU_WIDTH, playing ? 335 : 300, 'menu-dialog', () => this.close());
    this.modal = modal;
    const look = lookOf(provider, GAME_DIALOG_INFO);
    paintPanel(modal.panel, look);
    const confirm = (text: number, yes: () => void) => () => {
      this.close();
      confirmPopup(parent, provider, text, yes, actions.click);
    };
    const then = (run: () => void) => () => {
      this.close();
      run();
    };
    const button = (y: number, label: number, testid: string, run: (() => void) | null) => {
      const b = easyButton(modal.panel, look, { ...MENU_BUTTON, y }, provider.string(label) ?? '', FONT.copper12, run, actions.click);
      b.dataset.testid = testid;
    };
    button(15, STRING.quit, 'menu-quit', confirm(CONFIRM_QUIT, actions.quit));
    let y = 65;
    if (playing) {
      button(y, STRING.resign, 'menu-resign', confirm(CONFIRM_RESIGN, actions.resign));
      y = 100;
    }
    button(y, STRING.achievements, 'menu-achievements', then(actions.achievements));
    button((y += 35), STRING.instructions, 'menu-instructions', null);
    button((y += 35), STRING.settings, 'menu-settings', then(actions.settings));
    button((y += 35), STRING.help, 'menu-help', null);
    button((y += 35), STRING.about, 'menu-about', null);
    button(y + 35 + 15, STRING.cancel, 'menu-cancel', () => this.close());
  }
}
