import { buildingFacet, checkObjCost, checkTechCost, master, TECHS, type Command, type Entity, type World } from '@aoe/sim';
import type { AssetProvider, ImageFrame } from '../assets';
import { paintFrame } from './frame-image';
import { bySlot, COMMAND_FRAME, commandButtons, FINAL_SLOT, type CommandButton, type CommandMode } from './commands';
import { SLP } from './layout';
import { infoOf } from './records';
import { commandMessage, objectName, shortMessage, techName } from './text';

/** An icon fills the slot inside its 2-pixel border (`TRIBE_Panel_Button::draw`, button type 0). */
const ICON_SIZE = 50;
/** button_border_a frames of a research button (`border_frame` 2, pressed 3); the others use 0 and 1. */
const RESEARCH_BORDER = 2;
/** How long a refusal stays on screen. */
const MESSAGE_MS = 4000;
/** `PLAYER_ATTRIBUTE_POPULATION`, `_POPULATION_HEADROOM` and `_POPULATION_LIMIT`. */
const ATTR_POPULATION = 11;
const ATTR_HEADROOM = 4;
const ATTR_POPULATION_LIMIT = 32;

export interface CommandPanelOptions {
  /** The 12 grid slots, row by row, placed by the HUD. */
  slots: readonly HTMLElement[];
  /** The message line: refusals, and the text of the button under the mouse. */
  message: HTMLElement;
  world: World;
  provider: AssetProvider;
  player: number;
  /** Interface culture of the art (Egyptian 0). */
  culture: number;
  /** Send a command through the lockstep. */
  issue: (command: Command) => void;
  /** Start placing a building; the HUD hears back through `placementChanged`. */
  startPlacement: (unit: number) => void;
  cancelPlacement: () => void;
  /** Clear the selection. */
  unselect: () => void;
  /** Make the selection a group, and take the selected objects out of their groups. */
  group: () => void;
  ungroup: () => void;
}

/**
 * The command button grid (`TRIBE_Screen_Game::setup_buttons` and `do_button_action`): each button is its icon inside
 * the slot border, pressed while the mouse is down on it; a train button shows how many are queued. Left click runs
 * the command, right click on a train button takes one off the queue, Esc presses the last slot (cancel or unselect).
 */
export class CommandPanel {
  private mode: CommandMode = 'normal';
  private page = 0;
  private buttons: (CommandButton | undefined)[] = [];
  private object: Entity | undefined;
  private selected: readonly Entity[] = [];
  private grouped = false;
  private shown = '';
  private pressed = -1;
  private hovered = -1;
  private messageTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly cleanup: (() => void)[] = [];

  constructor(private readonly o: CommandPanelOptions) {
    o.slots.forEach((slot, i) => {
      const icon = document.createElement('div');
      icon.className = 'hud-slot-icon';
      const count = document.createElement('span');
      count.className = 'hud-slot-count';
      slot.append(icon, count);
      const on = <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void) => {
        slot.addEventListener(type, fn);
        this.cleanup.push(() => slot.removeEventListener(type, fn));
      };
      on('pointerdown', (e) => {
        const b = this.buttons[i];
        // A disabled button does not take the mouse (`TButtonPanel::set_disabled`).
        if (!b || (b.kind === 'research' && b.disabled) || (e.button !== 0 && e.button !== 2)) return;
        this.pressed = i;
        this.render(true);
      });
      on('pointerup', (e) => {
        const was = this.pressed;
        this.pressed = -1;
        this.render(true);
        if (was === i) this.press(i, e.button === 2);
      });
      on('pointerenter', () => {
        this.hovered = i;
        this.showHover();
      });
      on('pointerleave', () => {
        this.hovered = -1;
        this.showHover();
        if (this.pressed !== i) return;
        this.pressed = -1;
        this.render(true);
      });
      on('contextmenu', (e) => e.preventDefault());
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.buttons[FINAL_SLOT]) this.press(FINAL_SLOT, false);
    };
    window.addEventListener('keydown', onKey);
    this.cleanup.push(() => window.removeEventListener('keydown', onKey));
  }

  destroy(): void {
    for (const fn of this.cleanup) fn();
    clearTimeout(this.messageTimer);
  }

  /** The game mode the grid is in. */
  get gameMode(): CommandMode {
    return this.mode;
  }

  /** Placing started or ended in the unit layer (a click placed the building, or right click stopped it). */
  placementChanged(unit: number | null): void {
    this.mode = unit === null ? 'normal' : 'place';
    this.update(this.object);
  }

  /**
   * Rebuilds the grid for `object` (the panel's object) and the whole selection; a different object goes back to the
   * normal mode.
   */
  update(object: Entity | undefined, selected: readonly Entity[] = this.selected, grouped = this.grouped): void {
    this.selected = selected;
    this.grouped = grouped;
    if (object?.id !== this.object?.id) {
      if (this.mode === 'place') this.o.cancelPlacement();
      this.mode = 'normal';
      this.page = 0;
    }
    this.object = object;
    const { world, player, provider } = this.o;
    const buttons = commandButtons({
      world,
      player,
      object,
      selected,
      grouped,
      mode: this.mode,
      page: this.page,
      buttonOf: (unit) => infoOf(provider, master(world, player, unit))?.button ?? null,
      techButtonOf: (tech) => provider.techInfo(tech)?.button ?? null,
      levelOf: (unit) => provider.unitInfo(unit)?.level ?? null,
    });
    this.buttons = bySlot(buttons);
    this.render(false);
  }

  private render(force: boolean): void {
    const key = JSON.stringify([this.buttons, this.pressed]);
    if (!force && key === this.shown) return;
    this.shown = key;
    this.o.slots.forEach((slot, i) => this.renderSlot(slot, this.buttons[i], this.pressed === i));
    this.showHover();
  }

  /**
   * The button under the mouse puts its message on the message line (`TRIBE_Screen_Game::handle_mouse_move` ->
   * `text_line_panel->show_message`): the item's text and cost, "Create Villager (C) (Food: 50)", or the command's.
   */
  private showHover(): void {
    const b = this.buttons[this.hovered];
    const { message } = this.o;
    if (b) {
      clearTimeout(this.messageTimer);
      message.textContent = commandMessage(this.o.provider, b, this.o.world, this.o.player);
      message.hidden = false;
      message.dataset.hover = 'true';
    } else if (message.dataset.hover) {
      delete message.dataset.hover;
      message.hidden = true;
    }
  }

  private renderSlot(slot: HTMLElement, b: CommandButton | undefined, down: boolean): void {
    const icon = slot.children[0] as HTMLElement;
    const count = slot.children[1] as HTMLElement;
    const { provider } = this.o;
    slot.classList.toggle('used', b !== undefined);
    slot.classList.toggle('down', down);
    slot.dataset.command = b?.kind ?? '';
    slot.dataset.unit = b && 'unit' in b ? String(b.unit) : '';
    slot.dataset.tech = b?.kind === 'research' ? String(b.tech) : '';
    const disabled = b?.kind === 'research' && b.disabled;
    slot.classList.toggle('disabled', disabled);
    const border = (b?.kind === 'research' ? RESEARCH_BORDER : 0) + (down ? 1 : 0);
    paintFrame(slot, b ? provider.interfaceFrame(SLP.buttonBorder + this.o.culture, border) : null);
    const art = b ? this.icon(b) : null;
    paintFrame(icon, art);
    icon.textContent = b && !art ? this.label(b) : '';
    count.textContent = b?.kind === 'train' && b.count > 0 ? String(b.count) : '';
  }

  /** The button's picture: a 50x50 corner of its frame (data2's btncmd frames are 800x600 with the icon top left). */
  private icon(b: CommandButton): ImageFrame | null {
    const { provider, player, world, culture } = this.o;
    let frame: ImageFrame | null;
    if (b.kind === 'place') {
      const info = infoOf(provider, master(world, player, b.unit));
      frame = info && info.icon >= 0 ? provider.interfaceFrame(SLP.buildingIcons + culture, buildingFacet(world, player, b.unit) + info.icon, player) : null;
    } else if (b.kind === 'train') {
      const info = infoOf(provider, master(world, player, b.unit));
      frame = info && info.icon >= 0 ? provider.interfaceFrame(SLP.unitIcons, info.icon, player) : null;
    } else if (b.kind === 'research') {
      const info = provider.techInfo(b.tech);
      frame = info && info.icon >= 0 ? provider.interfaceFrame(SLP.techIcons, info.icon, player) : null;
    } else {
      // Command pictures carry no colour table: their player-colour pixels stay the base (player 1) ramp.
      frame = provider.interfaceFrame(SLP.commands, COMMAND_FRAME[b.kind], 1);
    }
    return frame && { ...frame, w: Math.min(frame.w, ICON_SIZE), h: Math.min(frame.h, ICON_SIZE) };
  }

  /** Text in place of a missing picture. */
  private label(b: CommandButton): string {
    const { provider, world, player } = this.o;
    if (b.kind === 'place' || b.kind === 'train') return objectName(provider, b.unit, master(world, player, b.unit));
    return b.kind === 'research' ? techName(provider, b.tech) : commandMessage(provider, b, world, player);
  }

  /** `do_button_action`. */
  private press(slot: number, right: boolean): void {
    const b = this.buttons[slot];
    const object = this.object;
    if (!b || !object) return;
    const { world, player, issue } = this.o;
    switch (b.kind) {
      case 'build':
        this.mode = 'build-menu';
        this.page = 0;
        break;
      case 'more':
        this.page = this.page === 0 ? 1 : 0;
        break;
      case 'place':
        // `command_building`: placing starts only when the player can pay.
        if (checkObjCost(world.gameContext(), player, b.unit, 1, false)) this.o.startPlacement(b.unit);
        else this.refuse(master(world, player, b.unit).creatable?.costs ?? []);
        return;
      case 'train':
        // `command_train` with production queues: the sim pays, or refuses what the player cannot afford.
        issue({ type: 'queue', building: object.id, unit: b.unit, count: right ? -1 : 1 });
        return;
      case 'research':
        // `command_research`: the selected building researches when the player can pay; else the shortfall's message.
        if (b.disabled) return;
        if (checkTechCost(world, player, b.tech)) issue({ type: 'research', building: object.id, tech: b.tech });
        else this.refuse((TECHS[b.tech]?.costs ?? []).filter((c) => c.flag !== 0));
        return;
      case 'stop':
        // `command_stop`.
        issue({ type: 'stop', objects: [object.id] });
        return;
      case 'cancel-construction':
        issue({ type: 'cancel', target: object.id });
        return;
      case 'cancel':
        // `command_cancel`: leaves a mode, or in the normal mode unselects.
        if (this.mode === 'normal') return this.o.unselect();
        if (this.mode === 'place') this.o.cancelPlacement();
        this.mode = 'normal';
        break;
      case 'unselect':
        this.o.unselect();
        return;
      case 'group':
        this.o.group();
        break;
      case 'ungroup':
        this.o.ungroup();
        break;
    }
    this.update(object);
  }

  /**
   * The message `command_building` (and `command_research`) shows when a cost cannot be paid: the attribute
   * `check_obj_cost` (`check_tech_cost`) stops at (the population limit when headroom is asked for and the population is
   * at it, else the first used cost that falls short).
   */
  private refuse(slots: readonly { type: number; amount: number }[]): void {
    const a = this.o.world.attributes[this.o.player]!;
    const costs = slots.filter((c) => c.type >= 0);
    let short = -1;
    for (const c of costs) {
      if (c.type === ATTR_HEADROOM && a[ATTR_POPULATION]! >= a[ATTR_POPULATION_LIMIT]!) short = ATTR_POPULATION_LIMIT;
      else if ((a[c.type] ?? 0) < c.amount) short = c.type;
      if (short >= 0) break;
    }
    this.o.message.textContent = shortMessage(this.o.provider, short);
    this.o.message.hidden = false;
    delete this.o.message.dataset.hover;
    clearTimeout(this.messageTimer);
    this.messageTimer = setTimeout(() => (this.o.message.hidden = true), MESSAGE_MS);
  }
}
