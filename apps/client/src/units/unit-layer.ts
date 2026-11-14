import { Graphics, Sprite, type Application, type Texture, type Ticker } from 'pixi.js';
import { buildingFacet, checkPlacement, ObjectState, spriteInfo, UNIT_TYPES, unitType, type Command, type Entity, type World } from '@aoe/sim';
import { DebugProvider } from '../assets/debug-provider';
import type { AssetProvider, GraphicInfo, SpriteFrame } from '../assets';
import { canBuild } from '../hud/commands';
import { frameCursor } from '../hud/frame-image';
import { SLP } from '../hud/layout';
import { pixelToTileCoords, tileCoordsToPixel } from '../map/iso';
import type { MapView } from '../map/map-view';
import { composeGraphic } from './composite';
import { facingFrame } from './facing';
import { ATTACK_CURSOR_FRAME, canAttack, isAttackable } from './mouse-actions';
import { alignBuilding } from './placement';

/** Pointer travel (CSS px) after which a left press becomes a selection box instead of a click. */
const BOX_THRESHOLD = 4;
const SELECTION_COLOUR = 0xffffff;
/** The hit point bar over a selected object: width in pixels, and palette indices 0x4a (green) and 0x97 (red). */
const BAR_WIDTH = 24;
const BAR_FILLED = 0x00ff00;
const BAR_EMPTY = 0xff0101;
/**
 * The building being placed is drawn see-through (`fog_next_shape` 5 where it fits); where it does not, also shaded
 * with a red that pulses (palette 0x24-0x28, stepping every 128 ms of world time).
 */
const GHOST_ALPHA = 0.6;
const GHOST_BLOCKED = [0xff2f2f, 0xe30b00, 0xc71700, 0x8f1f00, 0x6f0b07] as const;

interface Art {
  frames: SpriteFrame[];
  info: GraphicInfo | null;
  /** From the pack (false: debug shapes). */
  pack: boolean;
}

/** Where a unit is drawn: sim positions only change once per turn, so the drawing slides between them. */
interface Track {
  sprite: Sprite;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  start: number;
  duration: number;
  /** Graphic being drawn, and when (and from which sim frame) its animation started. */
  graphic: number;
  animStart: number;
  startFrame: number;
  pack: boolean;
}

/**
 * A unit that can be selected and ordered (`master_type` 70). Buildings (80), missiles (60) and dead units (30) carry a
 * mover in the sim too but are not.
 */
export function isUnit(e: Entity): boolean {
  return e.mover !== undefined && unitType(e.type).masterType === 70;
}

/** A building (foundations too) of the sim's table. */
export function isBuildingObject(e: Entity): boolean {
  return UNIT_TYPES.get(e.type)?.masterType === 80;
}

/**
 * Facet to draw: a building's `facet` (its construction stage while unbuilt), a mover's heading. A still object with facings (the mines' pile variants) gets one by id, as the
 * sim keeps none (the original takes it from the scenario or map data, `make_scenario_obj`); others use facet 0.
 */
function facetOf(e: Entity, angles: number): number {
  if (e.facet !== undefined) return e.facet;
  if (e.mover) return e.mover.facet;
  return e.sprite && spriteInfo(e.sprite.graphic).hasFacings ? e.id % angles : 0;
}

export interface UnitLayerOptions {
  app: Application;
  view: MapView;
  world: World;
  provider: AssetProvider;
  /** Sim player number of this client. */
  player: number;
  /** Send a command through the lockstep. */
  issue: (command: Command) => void;
  /** Wall-clock length of a turn, to spread its movement over. */
  turnMs: (turn: number) => number;
  /** Placing a building started (its master id) or ended (null). */
  onPlacement?: (unit: number | null) => void;
}

/** The building following the pointer while placing: the aligned map point and whether it fits there. */
export interface Ghost {
  unit: number;
  x: number;
  y: number;
  fits: boolean;
}

/** Alpha of a pixel of `sprite`'s texture under canvas point (x, y) is above this to count as a hit. */
const HIT_ALPHA = 8;
/** Pixels a tile of height (`world_z`) raises a drawn object: `tile_half_height` (src/stat_obj.cpp:1637). */
const Z_PIXELS = 16;

/**
 * Draws every sim object on the map layer (units, buildings, trees, mines, animals, carcasses) with its real sprite
 * as the sim reports it (owner colour, facing, task animation) and handles the original's mouse scheme: left click or
 * drag a box to select own units, or click an own building, right click to order the selected units to attack the
 * enemy object under the pointer (an `attack` command), to work on any other object there (a `work` command) or, over
 * bare ground, to move there. While a building is being placed its
 * ghost follows the pointer; a left click issues `build`, a right click stops placing.
 */
export class UnitLayer {
  readonly selected = new Set<number>();
  private readonly tracks = new Map<number, Track>();
  private readonly art = new Map<string, Art | null>();
  private readonly highlight = new Graphics();
  private readonly box = new Graphics();
  private readonly fallback = new DebugProvider();
  private readonly tick: (ticker: Ticker) => void;
  private readonly cleanup: (() => void)[] = [];
  private readonly alpha = new WeakMap<Texture, { pixels: Uint8ClampedArray; width: number } | null>();
  private seenTurn: number;
  private press: { x: number; y: number; boxing: boolean } | null = null;
  /** Master id of the building being placed (`TRIBE_GAME_MODE_PLACE_BUILDING`), or null. */
  private placing: number | null = null;
  private readonly ghostSprite = new Sprite();
  private ghostAt: Ghost | null = null;
  /** Canvas pixel of the pointer while it is over the canvas. */
  private pointer: { x: number; y: number } | null = null;
  /** CSS cursor over an attack target: the original's sword, or the browser's crosshair without art. */
  private attackCursor = 'crosshair';

  constructor(private readonly o: UnitLayerOptions) {
    this.seenTurn = o.world.turn;
    this.highlight.zIndex = Number.MAX_SAFE_INTEGER;
    o.view.layer.addChild(this.highlight);
    this.ghostSprite.zIndex = Number.MAX_SAFE_INTEGER - 1;
    this.ghostSprite.visible = false;
    o.view.layer.addChild(this.ghostSprite);
    o.app.stage.addChild(this.box);
    this.tick = () => this.draw();
    o.app.ticker.add(this.tick);
    this.listen(o.app.canvas);
    this.draw();
    const sword = o.provider.interfaceFrame(SLP.cursors, ATTACK_CURSOR_FRAME);
    if (sword) void frameCursor(sword, 'crosshair').then((c) => (this.attackCursor = c)).catch(() => undefined);
  }

  /** Own units, for centring the view at the start. */
  ownUnits(): Entity[] {
    return [...this.o.world.entities.ofPlayer(this.o.player)].filter(isUnit);
  }

  /** Canvas pixel where unit `id` is drawn (its map position), or null. */
  screenPos(id: number): { x: number; y: number } | null {
    const t = this.tracks.get(id);
    if (!t) return null;
    const { x, y } = this.drawnAt(t, performance.now());
    const p = tileCoordsToPixel(x, y, this.o.world.map.width);
    return { x: p.x - this.o.view.camera.x, y: p.y - this.o.view.camera.y };
  }

  /**
   * Canvas pixel at the middle of object `id`'s drawn sprite, or the drawn pixel nearest it when the middle is see-through
   * (where a click lands on its body), or null.
   */
  objectCentre(id: number): { x: number; y: number } | null {
    const t = this.tracks.get(id);
    if (!t?.sprite.visible) return null;
    const b = t.sprite.getBounds();
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    let best: { x: number; y: number; d: number } | null = null;
    for (let y = Math.floor(b.y) + 1; y < b.y + b.height; y += 2) {
      for (let x = Math.floor(b.x) + 1; x < b.x + b.width; x += 2) {
        const d = (x - cx) ** 2 + (y - cy) ** 2;
        if ((!best || d < best.d) && this.opaque(t.sprite, x, y)) best = { x, y, d };
      }
    }
    return this.opaque(t.sprite, cx, cy) || !best ? { x: cx, y: cy } : { x: best.x, y: best.y };
  }

  /** How many drawn objects show pack art (not debug shapes). */
  get packSprites(): number {
    let n = 0;
    for (const t of this.tracks.values()) if (t.sprite.visible && t.pack) n++;
    return n;
  }

  /** The building being placed and where it would go, while its ghost is shown. */
  get ghost(): Ghost | null {
    return this.placing === null ? null : this.ghostAt;
  }

  /** Start placing building `unit` (`command_building`): its ghost follows the pointer until a click. */
  startPlacement(unit: number): void {
    this.placing = unit;
    this.press = null;
    this.box.clear();
    this.o.onPlacement?.(unit);
  }

  /** Stop placing (right click, Esc, the cancel button). */
  cancelPlacement(): void {
    if (this.placing === null) return;
    this.placing = null;
    this.ghostAt = null;
    this.ghostSprite.visible = false;
    this.o.onPlacement?.(null);
  }

  destroy(): void {
    this.o.app.ticker.remove(this.tick);
    this.o.app.canvas.style.cursor = '';
    for (const fn of this.cleanup) fn();
    for (const t of this.tracks.values()) t.sprite.destroy();
    this.highlight.destroy();
    this.ghostSprite.destroy();
    this.box.destroy();
  }

  private loadArt(graphic: number, owner: number): Art | null {
    // Gaia's objects have no player colour; any owner image will do.
    if (owner === 0) owner = 1;
    const key = `${graphic}:${owner}`;
    if (this.art.has(key)) return this.art.get(key)!;
    this.art.set(key, null);
    const { provider, app } = this.o;
    const info = provider.graphicInfo(graphic);
    const composite = info !== null && info.deltas.length > 0;
    const frames = composite ? composeGraphic(provider, app.renderer, graphic, info, owner) : provider.graphicFrames(graphic, owner);
    void frames.then(async (frames) => {
      if (frames.length > 0) this.art.set(key, { frames, info: composite ? { ...info, mirroringMode: 0 } : info, pack: true });
      else this.art.set(key, { frames: await this.fallback.graphicFrames(graphic, owner), info: null, pack: false });
    });
    return null;
  }

  private drawnAt(t: Track, now: number): { x: number; y: number } {
    const k = t.duration > 0 ? Math.min(1, (now - t.start) / t.duration) : 1;
    return { x: t.fromX + (t.toX - t.fromX) * k, y: t.fromY + (t.toY - t.fromY) * k };
  }

  private draw(): void {
    const { world, view } = this.o;
    const now = performance.now();
    const newTurn = world.turn !== this.seenTurn;
    const duration = newTurn ? this.o.turnMs(world.turn - 1) : 0;
    this.seenTurn = world.turn;
    const width = world.map.width;
    const alive = new Set<number>();
    for (const e of world.entities.all()) {
      // Probe entities of `test` commands have no sprite and are not drawn.
      if (!e.sprite) continue;
      alive.add(e.id);
      let t = this.tracks.get(e.id);
      if (!t) {
        t = { sprite: new Sprite(), fromX: e.x, fromY: e.y, toX: e.x, toY: e.y, start: now, duration: 0, graphic: -1, animStart: now, startFrame: 0, pack: false };
        view.layer.addChild(t.sprite);
        this.tracks.set(e.id, t);
      } else if (newTurn) {
        const at = this.drawnAt(t, now);
        Object.assign(t, { fromX: at.x, fromY: at.y, toX: e.x, toY: e.y, start: now, duration });
      }
      const type = unitType(e.type);
      const sliding = now - t.start < t.duration && (t.fromX !== t.toX || t.fromY !== t.toY);
      // The sim names the sprite; a unit still sliding after the sim stopped it keeps walking until it arrives.
      const slide = sliding && type.walking && e.sprite.graphic === type.standing.graphic;
      const graphic = slide ? type.walking!.graphic : e.sprite.graphic;
      if (graphic !== t.graphic) {
        t.graphic = graphic;
        t.animStart = now;
        t.startFrame = slide ? 0 : e.sprite.frame;
      }
      const art = this.loadArt(graphic, e.owner);
      const at = this.drawnAt(t, now);
      const pos = tileCoordsToPixel(at.x, at.y, width);
      // Missiles fly above the ground: `world_z` raises the sprite (the map is flat, so others stay at 0).
      const lift = Math.round(e.z * Z_PIXELS);
      t.sprite.visible = art !== null;
      if (!art) continue;
      t.pack = art.pack;
      const info = art.info;
      let step = 0;
      if (info && info.frameCount > 1) {
        const last = info.frameCount - 1;
        // A play-once sprite (the death animation) holds its last frame; the sim says when it has stopped.
        const once = (spriteInfo(e.sprite.graphic).flags & 8) !== 0 && !slide;
        step = once && e.sprite.flag === 0 ? last : t.startFrame + (info.frameDuration > 0 ? Math.floor((now - t.animStart) / 1000 / info.frameDuration) : 0);
        step = once ? Math.min(step, last) : step % info.frameCount;
      }
      const pick = info
        ? facingFrame(facetOf(e, info.angleCount), step, info.angleCount, info.frameCount, info.mirroringMode)
        : { index: 0, flipped: false };
      const frame = art.frames[pick.index] ?? art.frames[0]!;
      t.sprite.texture = frame.texture;
      t.sprite.scale.x = pick.flipped ? -1 : 1;
      t.sprite.position.set(pick.flipped ? pos.x + frame.hotspotX : pos.x - frame.hotspotX, pos.y - lift - frame.hotspotY);
      // Above every terrain tile; nearer the bottom of the screen draws later.
      t.sprite.zIndex = world.map.width * world.map.height + Math.round(pos.y);
    }
    for (const [id, t] of this.tracks) {
      if (alive.has(id)) continue;
      t.sprite.destroy();
      this.tracks.delete(id);
      this.selected.delete(id);
    }
    this.drawHighlight();
    this.drawGhost();
  }

  /**
   * `RGE_View::draw_place_object` (src/view.cpp:1160): the building's standing sprite at the aligned map point under the
   * pointer, in the player's colour and building facet, see-through, and shaded red where `check_placement` fails.
   */
  private drawGhost(): void {
    const sprite = this.ghostSprite;
    const unit = this.placing;
    sprite.visible = false;
    if (unit === null || !this.pointer) {
      this.ghostAt = null;
      return;
    }
    const { world, view, player } = this.o;
    const t = unitType(unit);
    const { camera } = view;
    const at = pixelToTileCoords(this.pointer.x + camera.x, this.pointer.y + camera.y, world.map.width);
    // `fixup_pick_info`: a point off the map is pulled onto its last tile.
    const col = Math.min(Math.max(at.col, 0), world.map.width - 1);
    const row = Math.min(Math.max(at.row, 0), world.map.height - 1);
    const { x, y } = alignBuilding(t.radiusX, t.radiusY, col, row, world.map.width, world.map.height);
    const fits = checkPlacement(world.gameContext(), t, x, y, true, true) === 0;
    this.ghostAt = { unit, x, y, fits };
    const art = this.loadArt(t.standing.graphic, player);
    if (!art) return;
    const info = art.info;
    const facet = buildingFacet(world, player, unit);
    const pick = info ? facingFrame(facet, 0, info.angleCount, info.frameCount, info.mirroringMode) : { index: 0, flipped: false };
    const frame = art.frames[pick.index] ?? art.frames[0]!;
    const pos = tileCoordsToPixel(x, y, world.map.width);
    sprite.texture = frame.texture;
    sprite.scale.x = pick.flipped ? -1 : 1;
    sprite.position.set(pick.flipped ? pos.x + frame.hotspotX : pos.x - frame.hotspotX, pos.y - frame.hotspotY);
    sprite.alpha = GHOST_ALPHA;
    const pulse = (world.worldTime >> 7) & 7;
    sprite.tint = fits ? 0xffffff : GHOST_BLOCKED[pulse < 4 ? pulse : 8 - pulse]!;
    sprite.visible = true;
  }

  /** Left click while placing (`command_place_object`): a `build` for the selected builders where the building fits. */
  private placeAt(keepPlacing: boolean): void {
    const ghost = this.ghostAt;
    if (!ghost?.fits) return;
    const units = this.selectedOwn().filter((id) => {
      const e = this.o.world.entities.get(id);
      return e !== undefined && isUnit(e) && canBuild(unitType(e.type));
    });
    if (units.length === 0) return;
    if (!keepPlacing) this.cancelPlacement();
    this.o.issue({ type: 'build', units, unitType: ghost.unit, x: ghost.x, y: ghost.y });
  }

  /**
   * The selection marker of the original's default outline (`outline_type` 2, RGE_Static_Object::capture_frame_3d_square):
   * a white diamond on the ground, the unit's outline radii wide, and a 24x2 hit point bar (green, red where hurt) over
   * its top corner while it has hit points left. Only selected objects show the bar (`selected & 1`, outline type 2).
   */
  private drawHighlight(): void {
    const g = this.highlight.clear();
    const { world, provider } = this.o;
    const now = performance.now();
    for (const id of this.selected) {
      const t = this.tracks.get(id);
      const e = world.entities.get(id);
      if (!t?.sprite.visible || !e) continue;
      const type = unitType(e.type);
      const [rx, ry, rz] = provider.unitInfo(e.type)?.outline ?? [type.radiusX, type.radiusY, type.radiusZ];
      const at = this.drawnAt(t, now);
      const o = tileCoordsToPixel(at.x, at.y, world.map.width);
      // RGE_Map::get_point: a tile offset (x, y, z) lands at ((y + x) * 32, (y - x - z) * 16) from the object.
      const point = (x: number, y: number, z: number) => ({ x: Math.round(o.x + (y + x) * 32), y: Math.round(o.y + (y - x - z) * 16) });
      const corners = [point(rx, -ry, 0), point(rx, ry, 0), point(-rx, ry, 0), point(-rx, -ry, 0)];
      g.poly(corners.flatMap((c) => [c.x + 0.5, c.y + 0.5])).stroke({ width: 1, color: SELECTION_COLOUR });
      const hp = Math.floor(e.hp);
      if (type.hitPoints <= 0 || hp <= 0) continue;
      const bar = point(rx, -ry, rz);
      const left = bar.x - 12;
      const top = bar.y - 2;
      const filled = hp >= type.hitPoints ? BAR_WIDTH : Math.min(BAR_WIDTH - 1, Math.floor((hp * BAR_WIDTH) / type.hitPoints) + 1);
      g.rect(left, top, BAR_WIDTH, 2).fill(BAR_EMPTY);
      g.rect(left, top, filled, 2).fill(BAR_FILLED);
    }
  }

  private listen(canvas: HTMLCanvasElement): void {
    const on = <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void) => {
      canvas.addEventListener(type, fn);
      this.cleanup.push(() => canvas.removeEventListener(type, fn));
    };
    const local = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    on('contextmenu', (e) => e.preventDefault());
    on('pointerleave', () => (this.pointer = null));
    on('pointerdown', (e) => {
      const p = local(e);
      this.pointer = p;
      if (this.placing !== null) {
        // Shift (or ctrl) keeps placing more of the same, as `reset_mode` 0 in the original.
        if (e.button === 0) {
          this.drawGhost();
          this.placeAt(e.shiftKey || e.ctrlKey);
        } else if (e.button === 2) this.cancelPlacement();
        return;
      }
      if (e.button === 0) this.press = { ...p, boxing: false };
      else if (e.button === 2) this.orderAt(p.x, p.y);
    });
    on('pointermove', (e) => {
      const p = local(e);
      this.pointer = p;
      if (this.placing !== null) return;
      if (!this.press) {
        canvas.style.cursor = this.attackTarget(p.x, p.y) ? this.attackCursor : this.workTarget(p.x, p.y) ? 'var(--cursor-work, pointer)' : '';
        return;
      }
      if (!this.press.boxing && Math.hypot(p.x - this.press.x, p.y - this.press.y) < BOX_THRESHOLD) return;
      this.press.boxing = true;
      this.box.clear().rect(Math.min(p.x, this.press.x), Math.min(p.y, this.press.y), Math.abs(p.x - this.press.x), Math.abs(p.y - this.press.y));
      this.box.stroke({ width: 1, color: SELECTION_COLOUR });
    });
    on('pointerup', (e) => {
      if (e.button !== 0 || !this.press) return;
      const p = local(e);
      const additive = e.shiftKey;
      if (!additive) this.selected.clear();
      if (this.press.boxing) this.selectBox(this.press.x, this.press.y, p.x, p.y);
      else this.selectAt(p.x, p.y);
      this.press = null;
      this.box.clear();
    });
  }

  private ownTracks(): [Entity, Track][] {
    const out: [Entity, Track][] = [];
    for (const e of this.ownUnits()) {
      const t = this.tracks.get(e.id);
      if (t?.sprite.visible) out.push([e, t]);
    }
    return out;
  }

  /** Topmost own unit whose sprite covers the canvas pixel, or own building whose drawn pixels do. */
  private selectAt(x: number, y: number): void {
    const hits: [Entity, Track][] = this.ownTracks().filter(([, t]) => t.sprite.getBounds().containsPoint(x, y));
    for (const e of this.o.world.entities.ofPlayer(this.o.player)) {
      const t = this.tracks.get(e.id);
      if (!isBuildingObject(e) || !t?.sprite.visible) continue;
      if (t.sprite.getBounds().containsPoint(x, y) && this.opaque(t.sprite, x, y)) hits.push([e, t]);
    }
    hits.sort((a, b) => b[1].sprite.zIndex - a[1].sprite.zIndex);
    if (hits[0]) this.selected.add(hits[0][0].id);
  }

  /** Own units whose map position lies inside the box. */
  private selectBox(x0: number, y0: number, x1: number, y1: number): void {
    const [left, right] = [Math.min(x0, x1), Math.max(x0, x1)];
    const [top, bottom] = [Math.min(y0, y1), Math.max(y0, y1)];
    for (const [e] of this.ownTracks()) {
      const p = this.screenPos(e.id)!;
      if (p.x >= left && p.x <= right && p.y >= top && p.y <= bottom) this.selected.add(e.id);
    }
  }

  /** Is the pixel of `sprite`'s texture under canvas point (x, y) opaque? Reads and caches the texture's pixels. */
  private opaque(sprite: Sprite, x: number, y: number): boolean {
    const texture = sprite.texture;
    let data = this.alpha.get(texture);
    if (data === undefined) {
      try {
        const { pixels, width } = this.o.app.renderer.extract.pixels(texture);
        data = { pixels, width };
      } catch {
        data = null;
      }
      this.alpha.set(texture, data);
    }
    if (!data) return true;
    const p = sprite.toLocal({ x, y });
    const [px, py] = [Math.floor(p.x), Math.floor(p.y)];
    if (px < 0 || py < 0 || px >= texture.frame.width || py >= texture.frame.height) return false;
    return data.pixels[(py * data.width + px) * 4 + 3]! > HIT_ALPHA;
  }

  /**
   * Topmost enemy object the selection can attack whose drawn pixels cover canvas point (x, y): another player's (not
   * Gaia's), alive (`object_state` up to active), of a group the right-click table attacks, with an attacker selected.
   */
  private attackTarget(x: number, y: number): Entity | undefined {
    const { world, player } = this.o;
    if (!this.selectedOwn().some((id) => canAttack(unitType(world.entities.get(id)!.type)))) return undefined;
    return this.topmostAt(x, y, (e) => e.owner > 0 && e.owner !== player && e.state <= ObjectState.Active && isAttackable(unitType(e.type)));
  }

  /** Topmost drawn object passing `test` whose pixels cover canvas point (x, y). */
  private topmostAt(x: number, y: number, test: (e: Entity) => boolean): Entity | undefined {
    const hits: [Entity, Track][] = [];
    for (const [id, t] of this.tracks) {
      const e = this.o.world.entities.get(id);
      if (!e || !t.sprite.visible || this.selected.has(id) || !test(e)) continue;
      if (t.sprite.getBounds().containsPoint(x, y) && this.opaque(t.sprite, x, y)) hits.push([e, t]);
    }
    hits.sort((a, b) => b[1].sprite.zIndex - a[1].sprite.zIndex);
    return hits[0]?.[0];
  }

  /** Topmost object a work order can target (Gaia's or an own non-unit) whose drawn pixels cover canvas point (x, y). */
  private workTarget(x: number, y: number): Entity | undefined {
    if (!this.hasOwnSelection()) return undefined;
    return this.topmostAt(x, y, (e) => e.owner === 0 || (e.owner === this.o.player && !isUnit(e)));
  }

  private selectedOwn(): number[] {
    return [...this.selected].filter((id) => this.o.world.entities.get(id)?.owner === this.o.player);
  }

  private hasOwnSelection(): boolean {
    return this.selectedOwn().some((id) => isUnit(this.o.world.entities.get(id)!));
  }

  /**
   * Right click: the selected units attack the enemy object under the pointer, or work on the object there, or else walk
   * to the map point there.
   */
  private orderAt(x: number, y: number): void {
    const units = this.selectedOwn().filter((id) => isUnit(this.o.world.entities.get(id)!));
    if (units.length === 0) return;
    const { camera } = this.o.view;
    const { col, row } = pixelToTileCoords(x + camera.x, y + camera.y, this.o.world.map.width);
    const { width, height } = this.o.world.map;
    if (col < 0 || row < 0 || col >= width || row >= height) return;
    const enemy = this.attackTarget(x, y);
    if (enemy) return this.o.issue({ type: 'attack', units, target: enemy.id });
    const target = this.workTarget(x, y);
    if (target) this.o.issue({ type: 'work', units, target: target.id, x: col, y: row });
    else this.o.issue({ type: 'move', units, x: col, y: row });
  }
}
