import type { Application, Ticker } from 'pixi.js';
import { ATTR_HEADROOM, ATTR_POPULATION, ATTR_POPULATION_LIMIT, HOUSE, ObjectState, typeOf, type Command, type Entity, type World } from '@aoe/sim';
import type { AssetProvider, ImageFrame } from '../assets';
import type { MapView } from '../map/map-view';
import { CommandPanel } from './command-panel';
import { constructionProgress, researchStatus, trainingStatus } from './commands';
import { applyCursors, clearCursors } from './cursors';
import { frameDataUrl, paintFrame } from './frame-image';
import { BOTTOM_HEIGHT, hudLayout, SLP, TOP_HEIGHT, type HudLayout, type Rect } from './layout';
import { Minimap, type MinimapUnits } from './minimap';
import { OptionsDialog, type OptionsSounds } from './options';
import { infoOf } from './records';
import { ResourceBar } from './resource-bar';
import { ageName, civilizationName, objectName, statRows, topButtonLabels } from './text';

/** Frames in health.shp; the bar shows frame `count - count * hp / max`. */
const HEALTH_FRAMES = 26;
/** Egyptian: the game does not track a player's culture yet. */
const CULTURE = 0;
/** Building icons live in a different SLP and are chosen by `master_type` 80 and over (the sim's `UnitType.masterType`). */
const BUILDING = 80;
/** A part of the top strip without icons or buttons (1024 art; the others are narrower but share the texture there). */
const STRIP_TILE = { x: 300, w: 200 };
/** itemicon.shp frames of the object panel's rows (`TRIBE_Panel_Object::draw_item`). */
const ITEM_POPULATION = 4;
const ITEM_PROGRESS = 9;
/**
 * The itemicon frame of a held resource by `attribute_type_held` (tpnl_obj.cpp:365-388): food (0, 15-17) 2, wood (1) 0,
 * stone (2) 1, gold (3) 3, trade goods (9) 5.
 */
const ITEM_HELD: Record<number, number> = { 0: 2, 15: 2, 16: 2, 17: 2, 1: 0, 2: 1, 3: 3, 9: 5 };
/** `unit_level`s whose own units show what they carry (3 villager, 4 soldier, 6 priest-like), and resource objects (1). */
const CARRIER_LEVELS = new Set([3, 4, 6]);
const LEVEL_RESOURCE = 1;
/** `PLAYER_ATTRIBUTE_CURRENT_AGE`. */
const ATTR_CURRENT_AGE = 6;
/** The rows' itemicon at (54, 30 + 20 * row) and value at (88, 33 + 20 * row) (`TRIBE_Panel_Object::draw_item`). */
const ROW_HEIGHT = 20;

/** One row of the object panel: `kind` names its test ids (`object-<kind>`, `object-<kind>-icon`). */
interface PanelRow {
  kind: string;
  icon: number;
  text: string;
}

/** The player's selection as the HUD reads and changes it (the unit layer's). */
export interface HudSelection {
  /** Every selected object (`sel_list`). */
  readonly selected: ReadonlySet<number>;
  /** The object the panel shows (`selected_obj`: the last one selected), or null. */
  readonly primary: number | null;
  /** Is object `id` in a group (`selected_group` != 0)? */
  isGrouped(id: number): boolean;
  /** `group_objects(-1)`, `ungroup_objects`, `unselect_object`. */
  group(): void;
  ungroup(): void;
  unselect(): void;
}

export interface GameHudOptions {
  /** The element the canvas sits in; the HUD covers it. */
  parent: HTMLElement;
  app: Application;
  world: World;
  provider: AssetProvider;
  /** Sim player number of this client. */
  player: number;
  /** The selection. */
  selection: HudSelection;
  /** Send a command through the lockstep. */
  issue: (command: Command) => void;
  /** Start and stop placing a building on the map. */
  startPlacement: (unit: number) => void;
  cancelPlacement: () => void;
  /** The map view and its units, for the minimap; without them the minimap's frame stays empty. */
  map?: { view: MapView; units: MinimapUnits };
  /** The buttons' click and the sound volume the Menu button's settings change; without it, no click and no settings. */
  sounds?: OptionsSounds;
}

function box(parent: HTMLElement | null, className: string, testid?: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = className;
  if (testid) el.dataset.testid = testid;
  parent?.append(el);
  return el;
}

function place(el: HTMLElement, r: Rect): void {
  Object.assign(el.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
}

/**
 * The game screen's panels in the original's layout and art (TRIBE_Screen_Game): the top strip with the resource
 * counts, the age and the chat, diplomacy and menu buttons, and the bottom panel with the selected object's panel, the
 * command button grid and the minimap frame. Without a pack the same boxes show on plain backgrounds.
 */
export class GameHud {
  readonly root = box(null, 'hud', 'hud');
  private readonly top = box(this.root, 'hud-top', 'hud-top');
  private readonly topFrame = box(this.top, 'hud-frame');
  private readonly age = box(this.topFrame, 'hud-age', 'age');
  private readonly menus = ['chat', 'diplomacy', 'menu'].map((name) => box(this.topFrame, 'hud-menu', `menu-${name}`));
  private readonly bottom = box(this.root, 'hud-bottom', 'hud-bottom');
  private readonly object = box(this.bottom, 'hud-object', 'object-panel');
  private readonly objectCiv = box(this.object, 'hud-object-civ', 'object-civ');
  private readonly objectName = box(this.object, 'hud-object-name', 'object-name');
  private readonly objectIcon = box(this.object, 'hud-object-icon', 'object-icon');
  private readonly objectHealth = box(this.object, 'hud-object-health', 'object-health');
  private readonly objectHp = box(this.object, 'hud-object-hp', 'object-hp');
  private rowEls: HTMLElement[] = [];
  private readonly slots = Array.from({ length: 12 }, () => box(this.bottom, 'hud-slot', 'command-slot'));
  private readonly minimap = box(this.bottom, 'hud-minimap', 'minimap');
  private readonly message = box(this.root, 'hud-message', 'hud-message');
  /** The command button grid. */
  readonly commands: CommandPanel;
  /** The minimap, when the HUD has a map view. */
  readonly minimapView: Minimap | null;
  /** The Menu button's settings (the sound volume), when the HUD has sounds. */
  readonly options: OptionsDialog | null;
  private readonly bar: ResourceBar;
  private readonly tick: (ticker: Ticker) => void;
  private readonly onResize = () => this.applyLayout();
  private layout: HudLayout | undefined;
  private shown: string | null = null;

  constructor(private readonly o: GameHudOptions) {
    o.parent.append(this.root);
    this.bar = new ResourceBar(this.topFrame, o.app, o.world, o.player);
    this.message.hidden = true;
    this.commands = new CommandPanel({
      slots: this.slots,
      message: this.message,
      world: o.world,
      provider: o.provider,
      player: o.player,
      culture: CULTURE,
      issue: o.issue,
      startPlacement: o.startPlacement,
      cancelPlacement: o.cancelPlacement,
      unselect: () => o.selection.unselect(),
      group: () => o.selection.group(),
      ungroup: () => o.selection.ungroup(),
      onButton: () => o.sounds?.button(),
    });
    const sounds = o.sounds;
    this.options = sounds ? new OptionsDialog(this.root, o.provider, sounds) : null;
    // The top strip's buttons click like the grid's (`RGE_Panel_Tool_Box` gets `get_sound(1)`, src/scr_game.cpp:466);
    // Menu opens the settings.
    this.menus.forEach((el, i) =>
      el.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        sounds?.button();
        if (i !== 2 || !this.options) return;
        if (this.options.open) this.options.close();
        else this.options.show();
      }),
    );
    this.minimapView = o.map ? new Minimap({ parent: this.minimap, world: o.world, provider: o.provider, player: o.player, ...o.map }) : null;
    topButtonLabels(o.provider).forEach((label, i) => (this.menus[i]!.textContent = label));
    this.root.classList.toggle('art', o.provider.interfaceFrame(SLP.screen[1024], 0) !== null);
    this.applyLayout();
    window.addEventListener('resize', this.onResize);
    this.tick = () => this.update();
    o.app.ticker.add(this.tick);
    this.update();
    void applyCursors(o.parent, o.provider).catch(() => undefined);
  }

  destroy(): void {
    this.o.app.ticker.remove(this.tick);
    window.removeEventListener('resize', this.onResize);
    this.bar.destroy();
    this.commands.destroy();
    this.minimapView?.destroy();
    clearCursors(this.o.parent);
    this.root.remove();
  }

  /** Picks the art for the window size and puts every panel where the original has it. */
  private applyLayout(): void {
    const l = hudLayout(window.innerWidth, window.innerHeight);
    if (l === this.layout) return;
    this.layout = l;
    const { provider } = this.o;
    const screen = SLP.screen[l.width];
    const topArt = provider.interfaceFrame(screen, 0);
    const bottomArt = provider.interfaceFrame(screen, 1);

    this.top.style.height = `${TOP_HEIGHT}px`;
    this.topFrame.style.width = `${l.width}px`;
    paintFrame(this.topFrame, topArt);
    // In a window wider than the art the strip carries on sideways with a plain stretch of it (between the icons and the
    // buttons); a background cannot repeat a part of an atlas, so that part is cut out.
    this.top.style.backgroundImage = '';
    if (topArt) {
      const plain = { ...topArt, x: topArt.x + STRIP_TILE.x, w: STRIP_TILE.w };
      void frameDataUrl(plain).then((url) => this.layout === l && (this.top.style.backgroundImage = `url(${url})`));
    }
    this.bar.place(l.resourceX);
    place(this.age, l.age);
    l.topButtons.forEach((r, i) => {
      const el = this.menus[i]!;
      place(el, r);
      paintFrame(el, provider.interfaceFrame(i === 1 ? SLP.wideMenuButton : SLP.menuButton, 0));
    });

    this.bottom.style.width = `${l.width}px`;
    this.bottom.style.height = `${BOTTOM_HEIGHT}px`;
    paintFrame(this.bottom, bottomArt);
    place(this.object, l.object);
    l.buttons.forEach((r, i) => place(this.slots[i]!, r));
    place(this.minimap, l.minimap);
    this.shown = null;
    this.update();
  }

  /**
   * The rollover text of the object under the pointer (`get_mouse_pointer_action_vars`' `text_id` on the view's message
   * panel), or null to take it away. A button's message replaces it while the pointer is on the grid.
   */
  rollover(text: string | null): void {
    const m = this.message;
    if (m.dataset.hover) return;
    if (text) {
      m.textContent = text;
      m.hidden = false;
      m.dataset.rollover = 'true';
    } else if (m.dataset.rollover) {
      delete m.dataset.rollover;
      m.hidden = true;
    }
  }

  /**
   * Shows the player's `selected_obj` in the object panel, as `TRIBE_Panel_Object::draw` does (one object, however
   * many are selected: scr_game.cpp:1183), its commands and the selection's in the button grid, and the age.
   */
  private update(): void {
    const { world, selection, player } = this.o;
    this.minimapView?.update();
    this.age.textContent = ageName(this.o.provider, world.attributes[player]![ATTR_CURRENT_AGE]!);
    const primary = selection.primary;
    const entity = primary === null ? undefined : world.entities.get(primary);
    const selected = [...selection.selected].flatMap((id) => world.entities.get(id) ?? []);
    this.commands.update(entity, selected, entity ? selection.isGrouped(entity.id) : false);
    // The object's own master: its owner's copy, which ages and techs change (hit points, attack, name and icon).
    const type = entity && typeOf(world, entity);
    const rows = entity ? this.rows(entity) : [];
    const facet = type?.building?.facet ?? 0;
    const key = entity
      ? `${entity.id}:${entity.type}:${entity.owner}:${Math.floor(entity.hp)}:${type!.hitPoints}:${type!.name}:${facet}:${JSON.stringify(rows)}`
      : '';
    if (key === this.shown) return;
    this.shown = key;
    this.object.hidden = !entity;
    if (!entity || !type) return;
    const { provider } = this.o;
    // Gaia's objects have no owner line; a player's shows the civilization (the scenario's player name in a campaign).
    this.objectCiv.textContent = entity.owner !== 0 ? civilizationName(provider, world.civs[entity.owner]!) : '';
    this.objectName.textContent = objectName(provider, entity.type, type);
    const info = infoOf(provider, type);
    const building = type.masterType >= BUILDING;
    // A building's picture is its master's `button_pict + building_facet` (tpnl_obj.cpp:180-185): the age's.
    const icon: ImageFrame | null =
      info && info.icon >= 0
        ? provider.interfaceFrame(building ? SLP.buildingIcons + CULTURE : SLP.unitIcons, info.icon + (building ? facet : 0), entity.owner)
        : null;
    paintFrame(this.objectIcon, icon);
    const hp = Math.max(0, Math.floor(entity.hp));
    const showHp = entity.hp > 0 && type.hitPoints > 0;
    this.objectHp.textContent = showHp ? `${hp}/${type.hitPoints}` : '';
    const frame = Math.min(HEALTH_FRAMES - 1, Math.max(0, Math.trunc(HEALTH_FRAMES - (HEALTH_FRAMES * entity.hp) / type.hitPoints)));
    this.objectHealth.hidden = !showHp;
    paintFrame(this.objectHealth, showHp ? provider.interfaceFrame(SLP.health, frame) : null);
    for (const el of this.rowEls) el.remove();
    this.rowEls = rows.flatMap((r, i) => {
      const icon = box(this.object, 'hud-object-row-icon', `object-${r.kind}-icon`);
      const text = box(this.object, 'hud-object-row', `object-${r.kind}`);
      icon.style.top = `${30 + i * ROW_HEIGHT}px`;
      text.style.top = `${33 + i * ROW_HEIGHT}px`;
      paintFrame(icon, provider.interfaceFrame(SLP.itemIcons, r.icon));
      text.textContent = r.text;
      return [icon, text];
    });
  }

  /**
   * The object panel's rows: the stats, then the own building's progress or population row as `item`, or what an own
   * unit carries, or what a resource object holds, as `held`.
   */
  private rows(e: Entity): PanelRow[] {
    const item = this.itemRow(e);
    const { world, player } = this.o;
    const busy = e.state === ObjectState.Unbuilt || (e.owner === player && (researchStatus(world, e) ?? trainingStatus(world, e)) !== null);
    const rows: PanelRow[] = statRows(this.o.provider, typeOf(world, e), busy);
    if (item) rows.push({ kind: 'item', ...item });
    const held = this.heldRow(e);
    if (held) rows.push({ kind: 'held', ...held });
    return rows;
  }

  /**
   * The held resource row (tpnl_obj.cpp:364-424): a resource object's (level 1) amount, whoever owns it; an own
   * villager's, soldier's or priest's load once it rounds to 1 or more. The value is `(int)(amount + 0.5)`.
   */
  private heldRow(e: Entity): { icon: number; text: string } | null {
    const level = this.o.provider.unitInfo(e.type)?.level;
    const icon = ITEM_HELD[e.heldType];
    if (level === undefined || icon === undefined) return null;
    const amount = Math.trunc(Math.fround(e.heldAmount + 0.5));
    if (level === LEVEL_RESOURCE) return { icon, text: String(amount) };
    if (!CARRIER_LEVELS.has(level) || e.owner !== this.o.player || amount < 1) return null;
    return { icon, text: String(amount) };
  }

  /**
   * The first row of the object panel for an own building (tpnl_obj.cpp:430-480): construction, research or training
   * progress in percent, or for a House the population over the room the houses give (capped by the population limit).
   */
  private itemRow(e: Entity): { icon: number; text: string } | null {
    const { world } = this.o;
    if (e.owner !== this.o.player || typeOf(world, e).masterType < BUILDING) return null;
    if (e.state === ObjectState.Unbuilt) return { icon: ITEM_PROGRESS, text: `${constructionProgress(world, e)}%` };
    // `work_status`: the building's action, a research or the unit in training, else the queue's first unit.
    const work = researchStatus(world, e) ?? trainingStatus(world, e);
    if (work) return { icon: ITEM_PROGRESS, text: `${work.progress}%` };
    if (e.type !== HOUSE) return null;
    const a = this.o.world.attributes[this.o.player]!;
    const population = Math.trunc(a[ATTR_POPULATION]!);
    const room = Math.min(Math.trunc(a[ATTR_HEADROOM]! + a[ATTR_POPULATION]!), Math.trunc(a[ATTR_POPULATION_LIMIT]!));
    return { icon: ITEM_POPULATION, text: `${population}/${room}` };
  }
}
