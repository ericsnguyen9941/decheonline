import type { Application, Ticker } from 'pixi.js';
import { unitType, type Entity, type World } from '@aoe/sim';
import type { AssetProvider, ImageFrame } from '../assets';
import { applyCursors, clearCursors } from './cursors';
import { frameDataUrl, paintFrame } from './frame-image';
import { BOTTOM_HEIGHT, hudLayout, SLP, TOP_HEIGHT, type HudLayout, type Rect } from './layout';
import { ResourceBar } from './resource-bar';

/** Frames in health.shp; the bar shows frame `count - count * hp / max`. */
const HEALTH_FRAMES = 26;
/** Egyptian: the game does not track a player's culture yet, and the sim's unit records are the first civ's. */
const CULTURE = 0;
/** Building icons live in a different SLP and are chosen by `master_type` 80 and over (the sim's `UnitType.masterType`). */
const BUILDING = 80;
/** A part of the top strip without icons or buttons (1024 art; the others are narrower but share the texture there). */
const STRIP_TILE = { x: 300, w: 200 };

export interface GameHudOptions {
  /** The element the canvas sits in; the HUD covers it. */
  parent: HTMLElement;
  app: Application;
  world: World;
  provider: AssetProvider;
  /** Sim player number of this client. */
  player: number;
  /** Ids of the selected objects. */
  selection: () => ReadonlySet<number>;
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
  private readonly menus = ['Chat', 'Diplomacy', 'Menu'].map((label) => {
    const el = box(this.topFrame, 'hud-menu');
    el.textContent = label;
    return el;
  });
  private readonly bottom = box(this.root, 'hud-bottom', 'hud-bottom');
  private readonly object = box(this.bottom, 'hud-object', 'object-panel');
  private readonly objectName = box(this.object, 'hud-object-name', 'object-name');
  private readonly objectIcon = box(this.object, 'hud-object-icon', 'object-icon');
  private readonly objectHealth = box(this.object, 'hud-object-health', 'object-health');
  private readonly objectHp = box(this.object, 'hud-object-hp', 'object-hp');
  private readonly slots = Array.from({ length: 12 }, () => box(this.bottom, 'hud-slot', 'command-slot'));
  private readonly minimap = box(this.bottom, 'hud-minimap', 'minimap');
  private readonly bar: ResourceBar;
  private readonly tick: (ticker: Ticker) => void;
  private readonly onResize = () => this.applyLayout();
  private layout: HudLayout | undefined;
  private shown: string | null = null;

  constructor(private readonly o: GameHudOptions) {
    o.parent.append(this.root);
    this.bar = new ResourceBar(this.topFrame, o.app, o.world, o.player);
    this.age.textContent = 'Stone Age';
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

  /** Shows the first selected object in the object panel, as `TRIBE_Panel_Object::draw` does for a single selection. */
  private update(): void {
    const { world, selection } = this.o;
    let entity: Entity | undefined;
    for (const id of selection()) {
      const e = world.entities.get(id);
      if (e && (!entity || e.id < entity.id)) entity = e;
    }
    const type = entity && unitType(entity.type);
    const key = entity ? `${entity.id}:${entity.type}:${entity.owner}:${Math.floor(entity.hp)}` : '';
    if (key === this.shown) return;
    this.shown = key;
    this.object.hidden = !entity;
    if (!entity || !type) return;
    const { provider } = this.o;
    this.objectName.textContent = type.name;
    const info = provider.unitInfo(entity.type);
    const building = type.masterType >= BUILDING;
    const icon: ImageFrame | null =
      info && info.icon >= 0 ? provider.interfaceFrame(building ? SLP.buildingIcons + CULTURE : SLP.unitIcons, info.icon, entity.owner) : null;
    paintFrame(this.objectIcon, icon);
    const hp = Math.max(0, Math.floor(entity.hp));
    const showHp = entity.hp > 0 && type.hitPoints > 0;
    this.objectHp.textContent = showHp ? `${hp}/${type.hitPoints}` : '';
    const frame = Math.min(HEALTH_FRAMES - 1, Math.max(0, Math.trunc(HEALTH_FRAMES - (HEALTH_FRAMES * entity.hp) / type.hitPoints)));
    this.objectHealth.hidden = !showHp;
    paintFrame(this.objectHealth, showHp ? provider.interfaceFrame(SLP.health, frame) : null);
  }
}
