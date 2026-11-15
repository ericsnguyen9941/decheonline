// The look of the original's `TEasy_Panel` screens and dialogs (src/Panel_ez.cpp): a background picture (tiled for the
// in-game dialogs), a three-pixel bevel (`DrawBevel3`, src/drawarea.cpp:2030) in the info file's six colours, and
// buttons drawn as text over the background shaded `shade_amount` percent darker with the same bevel
// (`TEasy_Panel::create_button`, src/Panel_ez.cpp:826; `TButtonPanel::draw`, src/pnl_btn.cpp:536). Colours come from
// the pack's screen table (`PackScreen`); without a pack, plain stand-ins.
import type { PackScreen } from '@aoe/assets-import/manifest';
import type { AssetProvider, ImageFrame } from '../assets';
import { frameDataUrl, paintFrame } from './frame-image';

/** `dlg6_<culture>`: the info file of the game screen's dialogs (src/scr_game.cpp:2163, 50006 + culture). */
export const GAME_DIALOG_INFO = 50006;

/**
 * CSS classes of the original's fonts (`RGE_Base_Game::setup_fonts`, src/basegame.cpp:1895; face, points and weight
 * from language strings 110-133, `lfHeight = points * 96 / 72` pixels): `RGE_FONT_COPPERPLATE_12_BOLD`, `_21_BOLD`,
 * `RGE_FONT_STANDARD` (Arial 10 bold) and `RGE_FONT_STRIKEOUT` (the same, struck out).
 */
export const FONT = { copper12: 'aoe-font-copper12', copper21: 'aoe-font-copper21', standard: 'aoe-font-standard', strikeout: 'aoe-font-strikeout' } as const;

/** A screen's look, its colours as CSS. */
export interface PanelLook {
  /** Background picture for the screen size, or null. */
  background: ImageFrame | null;
  /** 0 at the top left, 1 centred, 2 tiled. */
  position: number;
  shade: number;
  backgroundColour: string;
  bevels: string[];
  text: [string, string];
  focus: [string, string];
  state: [string, string];
}

const css = (rgb: number): string => `#${rgb.toString(16).padStart(6, '0')}`;

/** Without a pack: the in-game dialog's colours, roughly. */
const PLAIN: PackScreen = {
  backgrounds: [-1, -1, -1],
  position: 2,
  shade: 45,
  background: 0x6b4f2f,
  bevels: [0xe0c8a0, 0xb09070, 0x907050, 0x604020, 0x402810, 0x201008],
  text: [0xffffff, 0],
  focus: [0xffff00, 0],
  state: [0xffffff, 0],
};

/** The look of info file `id` for a screen `width` wide (640, 800 or 1024 picks the background). */
export function lookOf(provider: AssetProvider, id: number, width: 640 | 800 | 1024 = 640): PanelLook {
  const s = provider.screen(id) ?? PLAIN;
  const slp = s.backgrounds[width === 1024 ? 2 : width === 800 ? 1 : 0];
  // A missing size falls back to the first, as `TEasy_Panel::setup` keeps `background_pic` when 2 or 3 is "none".
  const background = (slp !== undefined && slp >= 0 ? provider.interfaceFrame(slp, 0) : null) ?? (s.backgrounds[0] >= 0 ? provider.interfaceFrame(s.backgrounds[0], 0) : null);
  return {
    background,
    position: s.position,
    shade: s.shade,
    backgroundColour: css(s.background),
    bevels: s.bevels.map(css),
    text: [css(s.text[0]), css(s.text[1])],
    focus: [css(s.focus[0]), css(s.focus[1])],
    state: [css(s.state[0]), css(s.state[1])],
  };
}

/**
 * `DrawBevel3` as inset shadows: the outer ring's top and right edges in colour 1, its bottom and left in 6; the next
 * ring 2 and 5, the inner one 3 and 4. `pressed` is `DrawBevel32`'s reversed order.
 */
export function bevel3(colours: readonly string[], pressed = false): string {
  const c = pressed ? [...colours].reverse() : colours;
  const ring = (i: number, light: string, dark: string) =>
    [`inset 0 ${i}px 0 ${light}`, `inset -${i}px 0 0 ${light}`, `inset 0 -${i}px 0 ${dark}`, `inset ${i}px 0 0 ${dark}`];
  return [...ring(1, c[0]!, c[5]!), ...ring(2, c[1]!, c[4]!), ...ring(3, c[2]!, c[3]!)].join(', ');
}

/** Paints a panel's background: its picture (tiled when `position` is 2) over its colour, then the bevel. */
export function paintPanel(el: HTMLElement, look: PanelLook, bevel = true): void {
  el.style.backgroundColor = look.backgroundColour;
  el.style.boxShadow = bevel ? bevel3(look.bevels) : '';
  const bg = look.background;
  if (!bg) return;
  if (look.position === 2) {
    void frameDataUrl(bg).then((url) => {
      el.style.backgroundImage = `url(${url})`;
      el.style.backgroundRepeat = 'repeat';
    });
  } else {
    paintFrame(el, bg);
    el.style.backgroundRepeat = 'no-repeat';
    if (look.position === 1) el.style.backgroundPosition = `calc(50% - ${bg.x}px) calc(50% - ${bg.y}px)`;
  }
}

/** Text in colour 1 with colour 2 as its shadow, as `set_text_color(c1, c2)` draws it. */
export function textColours(el: HTMLElement, [c1, c2]: readonly [string, string]): void {
  el.style.color = c1;
  el.style.textShadow = `-1px 1px 0 ${c2}`;
}

/** An absolutely placed element at (x, y), w x h, in `parent`'s pixels. */
export function placed<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, className: string, x: number, y: number, w: number, h: number): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.className = className;
  Object.assign(el.style, { position: 'absolute', left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
  parent.append(el);
  return el;
}

/**
 * A text button (`TButtonPanel::DrawText` with bevel type 4): the label in the text colours (focus colours under the
 * pointer), the bevel pressed while held. A disabled one draws two plain rectangles in colours 6 and 1 and does nothing.
 */
export function easyButton(
  parent: HTMLElement,
  look: PanelLook,
  r: { x: number; y: number; w: number; h: number },
  label: string,
  font: string,
  run: (() => void) | null,
  onPress?: () => void,
): HTMLButtonElement {
  const b = placed(parent, 'button', `aoe-button ${font}`, r.x, r.y, r.w, r.h);
  b.textContent = label;
  b.style.backgroundColor = `rgba(0, 0, 0, ${look.shade / 100})`;
  const colours = (hover: boolean) => textColours(b, hover ? look.focus : look.text);
  colours(false);
  if (!run) {
    b.disabled = true;
    b.style.boxShadow = `inset 0 0 0 1px ${look.bevels[5]}, inset 0 0 0 2px ${look.bevels[0]}`;
    return b;
  }
  b.style.boxShadow = bevel3(look.bevels);
  b.addEventListener('pointerenter', () => colours(true));
  b.addEventListener('pointerleave', () => {
    colours(false);
    b.style.boxShadow = bevel3(look.bevels);
  });
  b.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    b.style.boxShadow = bevel3(look.bevels, true);
    onPress?.();
  });
  b.addEventListener('pointerup', () => (b.style.boxShadow = bevel3(look.bevels)));
  b.addEventListener('click', run);
  return b;
}
