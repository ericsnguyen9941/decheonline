// The game screen's chat entry (docs/spec/chat.md): Enter's one-line chat bar (`TribeSendQuickMessageDialog`,
// src/dlg_smsg.cpp:342-444) and the Chat button's Send Messages dialog (`TribeSendMessageDialog`, src/dlg_smsg.cpp:23-358)
// with each player's row, the recipient check boxes and the Allies / Enemies / Everyone / Select Player buttons. Both
// are modal, centred, in the in-game dialogs' look (`dlg6_<culture>`). Received lines go on the chat lines (`ChatLines`).
import type { AssetProvider } from '../assets';
import { bevel3, easyButton, FONT, GAME_DIALOG_INFO, lookOf, paintPanel, placed, textColours, type PanelLook } from './easy-panel';
import { paintFrame } from './frame-image';
import { Modal } from './menu';

/** `STRING_ID_SEND_MESSAGE_*` (include/resource_ids.h:675-682) and `STRING_ID_ERROR_CHAT_AFTER_DEFEAT` (:742). */
export const STRING_CHAT = {
  title: 0x2667,
  chat: 0x2668,
  allies: 0x2669,
  enemies: 0x266a,
  everyone: 0x266b,
  returnToGame: 0x266c,
  selectPlayer: 0x266e,
  afterDefeat: 0xbfe,
} as const;
/** The game's chat inputs take 65 characters (`create_edit(..., 65, ...)`, src/dlg_smsg.cpp:121, :365). */
export const GAME_CHAT_LENGTH = 65;
/** `btn6_0` (interfac.drs 50605), the in-game dialogs' `button_file`: check box frames 0 / 2, radio button 4 / 6. */
const BUTTON_PICS = 50605;
export const CHECK_FRAMES = [0, 2];
export const RADIO_FRAMES = [4, 6];
/** `dlg_plbn.shp` (0xC63A): the bar under a player's name, in the player's colour (`TribeSendMessageDialog::draw`). */
export const PLAYER_BAR = 0xc63a;

/** One row of the Send Messages dialog: a player in the game. */
export interface ChatPlayer {
  player: number;
  name: string;
  /** The civilization's name. */
  civ: string;
  /** Struck out: defeated (`game_status` 2), or no longer in the game. */
  out: boolean;
  /** Another player still in the game: it has a check box (`comm->GetPlayerHumanity`). */
  checkable: boolean;
}

export interface ChatEntryOptions {
  parent: HTMLElement;
  provider: AssetProvider;
  /** The chat group (`TChat::chatGroupPlayers`): player numbers a message goes to. The dialog changes it. */
  group: Set<number>;
  /** The rows of the dialog, in player order. */
  players(): ChatPlayer[];
  /** `isAlly` and `isEnemy` of this player towards `p` (src/dlg_smsg.cpp:281-305). */
  isAlly(p: number): boolean;
  isEnemy(p: number): boolean;
  /** `SendGroupChatMsg(text)` (or nothing in the game over mode). */
  send(text: string): void;
  /** A button's click. */
  click(): void;
}

/** A chat input in the dialogs' look: `TEditPanel` with bevel type 3, text colours, focus colours while it has focus. */
function chatInput(parent: HTMLElement, look: PanelLook, x: number, y: number, w: number, h: number, testid: string): HTMLInputElement {
  const input = placed(parent, 'input', `aoe-edit ${FONT.standard}`, x, y, w, h);
  Object.assign(input, { type: 'text', maxLength: GAME_CHAT_LENGTH, spellcheck: false, autocomplete: 'off' });
  input.dataset.testid = testid;
  input.style.backgroundColor = look.backgroundColour;
  // `DrawBevel2(c1, c2, c5, c6)`: two rings.
  const c = look.bevels;
  input.style.boxShadow = `inset 0 1px 0 ${c[0]}, inset -1px 0 0 ${c[0]}, inset 0 -1px 0 ${c[5]}, inset 1px 0 0 ${c[5]}, inset 0 2px 0 ${c[1]}, inset -2px 0 0 ${c[1]}, inset 0 -2px 0 ${c[4]}, inset 2px 0 0 ${c[4]}`;
  textColours(input, look.focus);
  return input;
}

/** A text panel: `horz` centres it across, every one here is centred top to bottom. */
export function label(parent: HTMLElement, look: PanelLook, text: string, font: string, x: number, y: number, w: number, h: number, horz: boolean): HTMLDivElement {
  const el = placed(parent, 'div', `aoe-text ${font}`, x, y, w, h);
  Object.assign(el.style, { display: 'flex', alignItems: 'center', justifyContent: horz ? 'center' : 'flex-start' });
  el.textContent = text;
  textColours(el, look.text);
  return el;
}

/** A check box or radio button (`create_check_box`, `create_radio_button`): `btn6_0` frame by state, bevel type 4. */
export class PictureButton {
  readonly el: HTMLButtonElement;
  private on = false;

  constructor(
    parent: HTMLElement,
    private readonly provider: AssetProvider,
    look: PanelLook,
    x: number,
    y: number,
    private readonly frames: number[],
    testid: string,
    run: () => void,
  ) {
    this.el = placed(parent, 'button', 'aoe-button aoe-picture-button', x, y, 30, 30);
    this.el.dataset.testid = testid;
    // The picture centred in the button (`auto_pic_pos`), the bevel over it.
    const pic = document.createElement('div');
    pic.className = 'aoe-picture';
    this.el.append(pic);
    this.el.style.boxShadow = bevel3(look.bevels);
    this.el.addEventListener('click', run);
    this.paint();
  }

  get state(): boolean {
    return this.on;
  }

  set state(on: boolean) {
    this.on = on;
    this.paint();
  }

  private paint(): void {
    const frame = this.provider.interfaceFrame(BUTTON_PICS, this.frames[this.on ? 1 : 0]!);
    const pic = this.el.firstElementChild as HTMLElement;
    this.el.dataset.state = this.on ? '1' : '0';
    if (!frame) {
      // Without the pack: the "X" text the original draws when the info file has no button pictures.
      pic.textContent = this.on ? 'X' : '';
      return;
    }
    Object.assign(pic.style, { width: `${frame.w}px`, height: `${frame.h}px`, left: `${15 - Math.trunc(frame.w / 2)}px`, top: `${15 - Math.trunc(frame.h / 2)}px` });
    paintFrame(pic, frame);
  }
}

/**
 * The chat entries of the game screen. Only one is open at a time; each is modal, so the game's keys and clicks wait
 * (`key_down_action` returns while `panel_system.modalPanel()` is set).
 */
export class ChatEntry {
  private modal: Modal | null = null;

  constructor(private readonly o: ChatEntryOptions) {}

  get open(): boolean {
    return this.modal !== null;
  }

  close(): void {
    this.modal?.close();
    this.modal = null;
  }

  /**
   * `TribeSendQuickMessageDialog(AsChat)`: 540 x 35, its label (9832) and a 65-character input. Enter sends the line and closes it
   * (an empty line just closes it); Esc or a click outside closes it without sending (src/dlg_smsg.cpp:388-444).
   */
  quick(): void {
    if (this.modal) return;
    const { provider } = this.o;
    const look = lookOf(provider, GAME_DIALOG_INFO);
    // eslint-disable-next-line prefer-const -- the input's handlers read the modal they are made for
    let input: HTMLInputElement;
    const modal = new Modal(this.o.parent, 540, 35, 'quick-chat', () => this.close(), () => {
      const text = input.value;
      this.close();
      if (text) this.o.send(text);
    });
    this.modal = modal;
    paintPanel(modal.panel, look);
    label(modal.panel, look, provider.string(STRING_CHAT.chat) ?? '', FONT.copper12, 5, 5, 120, 25, true);
    input = chatInput(modal.panel, look, 130, 5, 405, 25, 'chat-input');
    modal.cover.addEventListener('pointerdown', (e) => {
      if (e.target === modal.cover) this.close();
    });
    input.focus();
  }

  /**
   * `TribeSendMessageDialog`: 520 x 465. A row per player (name over its colour bar, civilization, a check box for each
   * other player in the game, checked when it is in the chat group), the chat input, the four recipient buttons and
   * Return to Game (Esc). Enter sends the line and keeps the dialog open; Return to Game keeps the check boxes as the
   * chat group, closes it and sends what is typed (src/dlg_smsg.cpp:193-306).
   */
  full(): void {
    if (this.modal) return;
    const { provider, group } = this.o;
    const look = lookOf(provider, GAME_DIALOG_INFO);
    // eslint-disable-next-line prefer-const -- the buttons' handlers read the input made after them
    let input: HTMLInputElement;
    const back = () => {
      this.o.click();
      keep();
      const text = input.value;
      this.close();
      if (text) this.o.send(text);
    };
    const modal = new Modal(this.o.parent, 520, 465, 'send-message', back, () => {
      const text = input.value;
      if (!text) return;
      this.o.send(text);
      input.value = '';
    });
    this.modal = modal;
    paintPanel(modal.panel, look);
    label(modal.panel, look, provider.string(STRING_CHAT.title) ?? '', FONT.copper21, 5, 10, 520 - 40, 30, true);

    const checks: { player: number; box: PictureButton }[] = [];
    // `checkButtons`: after every button, the check boxes are the chat group.
    const keep = () => {
      for (const { player, box } of checks) {
        if (box.state) group.add(player);
        else group.delete(player);
      }
    };
    const radios: PictureButton[] = [];
    const pick = (i: number) => radios.forEach((r, j) => (r.state = i === j));
    this.o.players().forEach((p, row) => {
      const y = 40 + 30 * row;
      const bar = placed(modal.panel, 'div', 'chat-player-bar', 0, 0, 0, 0);
      const frame = provider.interfaceFrame(PLAYER_BAR, 0, p.player);
      if (frame) {
        Object.assign(bar.style, { left: `${50 - frame.hotspotX}px`, top: `${y - frame.hotspotY}px`, width: `${frame.w}px`, height: `${frame.h}px` });
        paintFrame(bar, frame);
      }
      const name = label(modal.panel, look, p.name, p.out ? FONT.strikeout : FONT.standard, 50, y, 190, 30, false);
      name.dataset.testid = 'chat-player-name';
      label(modal.panel, look, p.civ, FONT.standard, 260, y, 120, 30, false).dataset.testid = 'chat-player-civ';
      if (!p.checkable) return;
      const box = new PictureButton(modal.panel, provider, look, 10, y, CHECK_FRAMES, `chat-to-${p.player}`, () => {
        this.o.click();
        box.state = !box.state;
        pick(3);
        keep();
      });
      box.state = group.has(p.player);
      checks.push({ player: p.player, box });
    });

    label(modal.panel, look, provider.string(STRING_CHAT.chat) ?? '', FONT.copper12, 10, 315, 120, 30, true);
    input = chatInput(modal.panel, look, 130, 315, 380, 23, 'chat-input');
    // Allies, Enemies, Everyone, Select Player: set the check boxes from the diplomacy (src/dlg_smsg.cpp:281-310).
    const set = (on: (p: number) => boolean) => {
      for (const c of checks) c.box.state = on(c.player);
    };
    const choices: [number, number, number, () => void][] = [
      [STRING_CHAT.allies, 45, 350, () => set((p) => this.o.isAlly(p))],
      [STRING_CHAT.enemies, 275, 350, () => set((p) => this.o.isEnemy(p))],
      [STRING_CHAT.everyone, 45, 385, () => set(() => true)],
      [STRING_CHAT.selectPlayer, 275, 385, () => undefined],
    ];
    const testids = ['allies', 'enemies', 'everyone', 'select-player'];
    choices.forEach(([id, x, y, run], i) => {
      const radio = new PictureButton(modal.panel, provider, look, x, y, RADIO_FRAMES, `chat-${testids[i]}`, () => {
        this.o.click();
        pick(i);
        run();
        keep();
      });
      radios.push(radio);
      label(modal.panel, look, provider.string(id) ?? '', FONT.standard, x + 30, y, 200, 30, false);
    });
    pick(3);
    easyButton(modal.panel, look, { x: 100, y: 425, w: 300, h: 30 }, provider.string(STRING_CHAT.returnToGame) ?? '', FONT.copper12, back).dataset.testid = 'chat-return';
    input.focus();
  }
}
