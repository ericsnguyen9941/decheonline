// The sound volume part of the original's Game Settings dialog (`TRIBE_Dialog_Config`, src/dlg_conf.cpp): a vertical
// slider from "High" at the top to "Off" at the bottom that changes the volume as it moves, OK keeps it, Cancel puts
// the old one back (src/dlg_conf.cpp:554-573). The game speed, music volume and scroll speed parts are not here.
import type { AssetProvider } from '../assets';
import { VOLUME_STOPS } from '../audio/sound-player';

/** `STRING_ID_GAME_SETTINGS_TITLE`, `_SOUND_VOLUME_TITLE`, `_AUDIO_VOLUME_HIGH`, `_AUDIO_VOLUME_OFF` (include/resource_ids.h:116-123), `STRING_ID_BUTTON_OK`, `_CANCEL`. */
const STRING_TITLE = 9431;
const STRING_SOUND_VOLUME = 9438;
const STRING_HIGH = 9436;
const STRING_OFF = 9437;
const STRING_OK = 4001;
const STRING_CANCEL = 4002;

/** The player's sound volume and the buttons' click, as the dialog reads and changes them. */
export interface OptionsSounds {
  /** The slider's position: 0 "High" .. `VOLUME_STOPS` "Off". */
  volume: number;
  button(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  e.textContent = text;
  return e;
}

export class OptionsDialog {
  readonly root = el('div', 'hud-options');
  private readonly slider = el('input', 'hud-options-slider');
  /** The volume when the dialog opened, for Cancel. */
  private before = 0;

  constructor(
    parent: HTMLElement,
    provider: AssetProvider,
    private readonly sounds: OptionsSounds,
  ) {
    // Like the other HUD labels, no English of its own: without the pack's strings they are empty.
    const text = (id: number) => provider.string(id) ?? '';
    this.root.dataset.testid = 'options-dialog';
    this.root.hidden = true;
    const volume = el('div', 'hud-options-volume');
    Object.assign(this.slider, { type: 'range', min: '0', max: String(VOLUME_STOPS), step: '1' });
    this.slider.dataset.testid = 'sound-volume';
    this.slider.addEventListener('input', () => (this.sounds.volume = Number(this.slider.value)));
    volume.append(
      el('div', 'hud-options-label', text(STRING_SOUND_VOLUME)),
      el('div', 'hud-options-high', text(STRING_HIGH)),
      this.slider,
      el('div', 'hud-options-off', text(STRING_OFF)),
    );
    const ok = this.button(text(STRING_OK), 'options-ok', () => this.close());
    const cancel = this.button(text(STRING_CANCEL), 'options-cancel', () => {
      this.sounds.volume = this.before;
      this.close();
    });
    const buttons = el('div', 'hud-options-buttons');
    buttons.append(ok, cancel);
    this.root.append(el('div', 'hud-options-title', text(STRING_TITLE)), volume, buttons);
    parent.append(this.root);
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  show(): void {
    this.before = this.sounds.volume;
    this.slider.value = String(this.before);
    this.root.hidden = false;
  }

  close(): void {
    this.root.hidden = true;
  }

  private button(label: string, testid: string, run: () => void): HTMLButtonElement {
    const b = el('button', 'hud-options-button', label);
    b.dataset.testid = testid;
    b.addEventListener('pointerdown', () => this.sounds.button());
    b.addEventListener('click', run);
    return b;
  }
}
