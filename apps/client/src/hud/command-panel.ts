import { ATTR_FOOD, ATTR_GOLD, ATTR_STONE, ATTR_WOOD, buildingFacet, checkObjCost, unitType, type Command, type Entity, type World } from '@aoe/sim';
import type { AssetProvider, ImageFrame } from '../assets';
import { paintFrame } from './frame-image';
import { bySlot, COMMAND_FRAME, commandButtons, FINAL_SLOT, type CommandButton, type CommandMode } from './commands';
import { SLP } from './layout';

/** An icon fills the slot inside its 2-pixel border (`TRIBE_Panel_Button::draw`, button type 0). */
const ICON_SIZE = 50;
/** How long a refusal stays on screen. */
const MESSAGE_MS = 4000;
/** Names of the resources a cost can lack; anything else is the population or a building limit. */
const RESOURCE_NAMES: Record<number, string> = { [ATTR_FOOD]: 'food', [ATTR_WOOD]: 'wood', [ATTR_STONE]: 'stone', [ATTR_GOLD]: 'gold' };

export interface CommandPanelOptions {
  /** The 12 grid slots, row by row, placed by the HUD. */
  slots: readonly HTMLElement[];
  /** Where refusals show. */
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
  private shown = '';
  private pressed = -1;
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
        if (!this.buttons[i] || (e.button !== 0 && e.button !== 2)) return;
        this.pressed = i;
        this.render(true);
      });
      on('pointerup', (e) => {
        const was = this.pressed;
        this.pressed = -1;
        this.render(true);
        if (was === i) this.press(i, e.button === 2);
      });
      on('pointerleave', () => {
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

  /** Rebuilds the grid for `object` (the panel's object); a different object goes back to the normal mode. */
  update(object: Entity | undefined): void {
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
      mode: this.mode,
      page: this.page,
      buttonOf: (unit) => provider.unitInfo(unit)?.button ?? null,
    });
    this.buttons = bySlot(buttons);
    this.render(false);
  }

  private render(force: boolean): void {
    const key = JSON.stringify([this.buttons, this.pressed]);
    if (!force && key === this.shown) return;
    this.shown = key;
    this.o.slots.forEach((slot, i) => this.renderSlot(slot, this.buttons[i], this.pressed === i));
  }

  private renderSlot(slot: HTMLElement, b: CommandButton | undefined, down: boolean): void {
    const icon = slot.children[0] as HTMLElement;
    const count = slot.children[1] as HTMLElement;
    const { provider } = this.o;
    slot.classList.toggle('used', b !== undefined);
    slot.classList.toggle('down', down);
    slot.dataset.command = b?.kind ?? '';
    slot.dataset.unit = b && 'unit' in b ? String(b.unit) : '';
    slot.title = b ? this.label(b) : '';
    paintFrame(slot, b ? provider.interfaceFrame(SLP.buttonBorder + this.o.culture, down ? 1 : 0) : null);
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
      const info = provider.unitInfo(b.unit);
      frame = info && info.icon >= 0 ? provider.interfaceFrame(SLP.buildingIcons + culture, buildingFacet(world, player, b.unit) + info.icon, player) : null;
    } else if (b.kind === 'train') {
      const info = provider.unitInfo(b.unit);
      frame = info && info.icon >= 0 ? provider.interfaceFrame(SLP.unitIcons, info.icon, player) : null;
    } else {
      // Command pictures carry no colour table: their player-colour pixels stay the base (player 1) ramp.
      frame = provider.interfaceFrame(SLP.commands, COMMAND_FRAME[b.kind], 1);
    }
    return frame && { ...frame, w: Math.min(frame.w, ICON_SIZE), h: Math.min(frame.h, ICON_SIZE) };
  }

  private label(b: CommandButton): string {
    switch (b.kind) {
      case 'place':
      case 'train':
        return unitType(b.unit).name;
      case 'build':
        return 'Build';
      case 'cancel-construction':
        return 'Cancel construction';
      case 'more':
        return 'More';
      case 'cancel':
        return 'Cancel';
      case 'unselect':
        return 'Unselect';
    }
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
        else this.refuse(b.unit);
        return;
      case 'train':
        // `command_train` with production queues: the sim pays, or refuses what the player cannot afford.
        issue({ type: 'queue', building: object.id, unit: b.unit, count: right ? -1 : 1 });
        return;
      case 'cancel-construction':
        issue({ type: 'cancel', target: object.id });
        return;
      case 'cancel':
        if (this.mode === 'place') this.o.cancelPlacement();
        this.mode = 'normal';
        break;
      case 'unselect':
        this.o.unselect();
        return;
    }
    this.update(object);
  }

  /** The message `command_building` shows when a cost cannot be paid: the first attribute that falls short. */
  private refuse(unit: number): void {
    const a = this.o.world.attributes[this.o.player]!;
    const short = unitType(unit).creatable?.costs.find((c) => (a[c.type] ?? 0) < c.amount);
    const what = short && RESOURCE_NAMES[short.type];
    this.o.message.textContent = what ? `Not enough ${what}.` : 'You cannot build that now.';
    this.o.message.hidden = false;
    clearTimeout(this.messageTimer);
    this.messageTimer = setTimeout(() => (this.o.message.hidden = true), MESSAGE_MS);
  }
}
