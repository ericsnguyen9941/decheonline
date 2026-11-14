import { Graphics, Sprite, type Application, type Texture, type Ticker } from 'pixi.js';
import { spriteInfo, unitType, type Command, type Entity, type World } from '@aoe/sim';
import { DebugProvider } from '../assets/debug-provider';
import type { AssetProvider, GraphicInfo, SpriteFrame } from '../assets';
import { pixelToTileCoords, tileCoordsToPixel } from '../map/iso';
import type { MapView } from '../map/map-view';
import { facingFrame } from './facing';

/** Pointer travel (CSS px) after which a left press becomes a selection box instead of a click. */
const BOX_THRESHOLD = 4;
const SELECTION_COLOUR = 0xffffff;

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

/** Buildings carry a mover in the sim but are not units: they cannot be selected or ordered (`master_type` 80). */
export function isUnit(e: Entity): boolean {
  return e.mover !== undefined && unitType(e.type).masterType < 80;
}

/**
 * Facet to draw: a mover's heading. A still object with facings (the mines' pile variants) gets one by id, as the
 * sim keeps none (the original takes it from the scenario or map data, `make_scenario_obj`); others use facet 0.
 */
function facetOf(e: Entity, angles: number): number {
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
}

/** Alpha of a pixel of `sprite`'s texture under canvas point (x, y) is above this to count as a hit. */
const HIT_ALPHA = 8;

/**
 * Draws every sim object on the map layer (units, buildings, trees, mines, animals, carcasses) with its real sprite
 * as the sim reports it (owner colour, facing, task animation) and handles the original's mouse scheme: left click or
 * drag a box to select own units, right click to order the selection to work on the object under the pointer (a
 * `work` command) or, over bare ground, to move there.
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

  constructor(private readonly o: UnitLayerOptions) {
    this.seenTurn = o.world.turn;
    this.highlight.zIndex = Number.MAX_SAFE_INTEGER;
    o.view.layer.addChild(this.highlight);
    o.app.stage.addChild(this.box);
    this.tick = () => this.draw();
    o.app.ticker.add(this.tick);
    this.listen(o.app.canvas);
    this.draw();
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

  /** Canvas pixel at the middle of object `id`'s drawn sprite (where a click lands on its body), or null. */
  objectCentre(id: number): { x: number; y: number } | null {
    const t = this.tracks.get(id);
    if (!t?.sprite.visible) return null;
    const b = t.sprite.getBounds();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }

  /** How many drawn objects show pack art (not debug shapes). */
  get packSprites(): number {
    let n = 0;
    for (const t of this.tracks.values()) if (t.sprite.visible && t.pack) n++;
    return n;
  }

  destroy(): void {
    this.o.app.ticker.remove(this.tick);
    this.o.app.canvas.style.cursor = '';
    for (const fn of this.cleanup) fn();
    for (const t of this.tracks.values()) t.sprite.destroy();
    this.highlight.destroy();
    this.box.destroy();
  }

  private loadArt(graphic: number, owner: number): Art | null {
    // Gaia's objects have no player colour; any owner image will do.
    if (owner === 0) owner = 1;
    const key = `${graphic}:${owner}`;
    if (this.art.has(key)) return this.art.get(key)!;
    this.art.set(key, null);
    void this.o.provider.graphicFrames(graphic, owner).then(async (frames) => {
      if (frames.length > 0) this.art.set(key, { frames, info: this.o.provider.graphicInfo(graphic), pack: true });
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
      t.sprite.position.set(pick.flipped ? pos.x + frame.hotspotX : pos.x - frame.hotspotX, pos.y - frame.hotspotY);
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
  }

  private drawHighlight(): void {
    const g = this.highlight.clear();
    for (const id of this.selected) {
      const t = this.tracks.get(id);
      if (!t?.sprite.visible) continue;
      const b = t.sprite.getLocalBounds();
      const x0 = t.sprite.x + (t.sprite.scale.x < 0 ? -b.maxX : b.minX);
      g.rect(x0 - 1, t.sprite.y + b.minY - 1, b.width + 2, b.height + 2);
    }
    g.stroke({ width: 1, color: SELECTION_COLOUR });
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
    on('pointerdown', (e) => {
      const p = local(e);
      if (e.button === 0) this.press = { ...p, boxing: false };
      else if (e.button === 2) this.orderAt(p.x, p.y);
    });
    on('pointermove', (e) => {
      const p = local(e);
      if (!this.press) {
        canvas.style.cursor = this.workTarget(p.x, p.y) ? 'pointer' : '';
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

  /** Topmost own unit whose sprite covers the canvas pixel. */
  private selectAt(x: number, y: number): void {
    const hits = this.ownTracks()
      .filter(([, t]) => t.sprite.getBounds().containsPoint(x, y))
      .sort((a, b) => b[1].sprite.zIndex - a[1].sprite.zIndex);
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

  /** Topmost object a work order can target (Gaia's or an own non-unit) whose drawn pixels cover canvas point (x, y). */
  private workTarget(x: number, y: number): Entity | undefined {
    if (!this.hasOwnSelection()) return undefined;
    const hits: [Entity, Track][] = [];
    for (const [id, t] of this.tracks) {
      const e = this.o.world.entities.get(id);
      if (!e || !t.sprite.visible || this.selected.has(id)) continue;
      if (e.owner !== 0 && (e.owner !== this.o.player || isUnit(e))) continue;
      if (t.sprite.getBounds().containsPoint(x, y) && this.opaque(t.sprite, x, y)) hits.push([e, t]);
    }
    hits.sort((a, b) => b[1].sprite.zIndex - a[1].sprite.zIndex);
    return hits[0]?.[0];
  }

  private selectedOwn(): number[] {
    return [...this.selected].filter((id) => this.o.world.entities.get(id)?.owner === this.o.player);
  }

  private hasOwnSelection(): boolean {
    return this.selectedOwn().length > 0;
  }

  /** Right click: the selected units work on the object under the pointer, or else walk to the map point there. */
  private orderAt(x: number, y: number): void {
    const units = this.selectedOwn();
    if (units.length === 0) return;
    const { camera } = this.o.view;
    const { col, row } = pixelToTileCoords(x + camera.x, y + camera.y, this.o.world.map.width);
    const { width, height } = this.o.world.map;
    if (col < 0 || row < 0 || col >= width || row >= height) return;
    const target = this.workTarget(x, y);
    if (target) this.o.issue({ type: 'work', units, target: target.id, x: col, y: row });
    else this.o.issue({ type: 'move', units, x: col, y: row });
  }
}
