import { AlphaFilter, Container, Graphics, Sprite, Texture, type Application, type Ticker } from 'pixi.js';
import type { TileMap } from '@aoe/sim';
import type { PackTileEdges } from '@aoe/assets-import/manifest';
import { DebugProvider } from '../assets/debug-provider';
import type { AssetProvider, SpriteFrame, TerrainLayout } from '../assets';
import { Camera, CameraControls } from './camera';
import { ELEV_H, Ground, tileCorners, tilePicture } from './elevation';
import { edgeNumber, FOG_W, fogHeight, fogPixels, PLAIN_EDGES, TILE_BLACK, TILE_VISIBLE } from './fog';
import { mapPixelSize, tileOrigin, visibleRange, type Rect } from './iso';

/** What the fog is drawn from: one player's knowledge of the tiles. */
export interface FogSource {
  /** `TILE_VISIBLE`, `TILE_FOGGED` or `TILE_BLACK` (`get_visible`). */
  state(col: number, row: number): number;
  /** Changes whenever `state` may have changed (each sim step). */
  version(): number;
}

interface TerrainArt extends TerrainLayout {
  frames: SpriteFrame[];
}


/**
 * Draws a `TileMap` as isometric tiles in `app.stage`, scrolled by a `Camera`. Only tiles that touch the viewport have
 * sprites. Each tile picks its frame like the original (`RGE_View::get_tile_picture`): its variant, and its slope's
 * picture raised by its height (`elevation.ts`), in the original's draw order (screen rows top to bottom).
 * With a `FogSource` (`setFog`) unexplored tiles are left black and fogged ones and the edges are shaded (`fog.ts`).
 */
export class MapView {
  readonly camera: Camera;
  readonly layer = new Container();
  /** The ground as drawn: tile types, heights, screen pixel to map point. */
  readonly ground: Ground;
  /**
   * Under the fog overlay, over every terrain tile: the parts of draw level 0-5, masked to the drawn terrain (outside the
   * map there is none, so what hangs off its edge is not drawn: `RGE_View::draw`'s terrain clip masks).
   */
  readonly terrainLayer = new Container();
  private readonly controls: CameraControls;
  private readonly active = new Map<number, Sprite>();
  private readonly spare: Sprite[] = [];
  private readonly tick: (ticker: Ticker) => void;
  private readonly onResize = (width: number, height: number) => {
    this.camera.resize(width, height);
    this.drawnAt = null;
    this.refresh();
  };
  private drawnAt: { x: number; y: number } | null = null;
  private fog: FogSource | null = null;
  private fogDrawn: { version: number; parity: number } | null = null;
  /** Above every terrain tile, under every object (their `zIndex` starts at the tile count). */
  private readonly fogLayer = new Container();
  private readonly overlays = new Map<number, Sprite>();
  /** Per drawn tile that may cover others' boxes (on a map with hills): erases their overlays under it. */
  private readonly erasers = new Map<number, Sprite>();
  private readonly fogTextures = new Map<string, Texture | null>();

  private constructor(
    private readonly app: Application,
    readonly map: TileMap,
    private readonly art: Map<number, TerrainArt>,
    readonly source: AssetProvider['kind'],
    private readonly edges: readonly PackTileEdges[],
  ) {
    this.camera = new Camera(map.width, map.height, app.screen.width, app.screen.height);
    this.ground = new Ground(map);
    this.layer.sortableChildren = true;
    this.terrainLayer.sortableChildren = true;
    this.terrainLayer.zIndex = map.width * map.height - 0.75;
    this.terrainLayer.mask = this.layer.addChild(this.terrainMask());
    this.layer.addChild(this.terrainLayer);
    this.fogLayer.zIndex = map.width * map.height - 0.5;
    if (!this.ground.flat) {
      // A raised tile overlaps the boxes of the tiles behind it: its overlay replaces theirs there (each tile is drawn
      // fogged or not as a whole, later tiles over earlier ones), so the overlays erase what they cover, off screen.
      this.fogLayer.sortableChildren = true;
      this.fogLayer.filters = [new AlphaFilter()];
    }
    this.layer.addChild(this.fogLayer);
    app.stage.addChild(this.layer);
    this.controls = new CameraControls(this.camera, app.canvas);
    this.tick = (ticker) => {
      this.controls.update(ticker.deltaMS);
      this.refresh();
    };
    app.ticker.add(this.tick);
    app.renderer.on('resize', this.onResize);
    const size = mapPixelSize(map.width, map.height);
    this.camera.centerOn(size.w / 2, size.h / 2);
    this.refresh();
  }

  /** Loads the art of every terrain the map uses; terrains the provider has no art for get debug shapes. */
  static async create(app: Application, map: TileMap, provider: AssetProvider): Promise<MapView> {
    const fallback = new DebugProvider();
    const art = new Map<number, TerrainArt>();
    for (const id of new Set(map.terrain)) {
      let frames = await provider.terrainFrames(id);
      let layout = provider.terrainLayout(id);
      if (frames.length === 0) {
        frames = await fallback.terrainFrames(id);
        layout = fallback.terrainLayout();
      }
      art.set(id, { frames, ...layout });
    }
    return new MapView(app, map, art, provider.kind, provider.mapArt()?.tileEdges ?? PLAIN_EDGES);
  }

  /** Map pixel rectangle the camera shows. */
  get view(): Rect {
    return { x: this.camera.x, y: this.camera.y, w: this.camera.viewW, h: this.camera.viewH };
  }

  /** Tiles that currently have a sprite. */
  get drawnTiles(): number {
    return this.active.size;
  }

  /** Draw the fog of `source` from now on (null: the whole map, as the scenario editor shows it). */
  setFog(source: FogSource | null): void {
    this.fog = source;
    this.fogDrawn = null;
    this.refresh();
  }

  /** The fog state drawn for tile (col, row): what `setFog`'s source says, `TILE_VISIBLE` without one. */
  fogState(col: number, row: number): number {
    return this.fog ? this.fog.state(col, row) : TILE_VISIBLE;
  }

  /** Move the camera so map pixel `(x, y)` is at the viewport centre. */
  centerOn(x: number, y: number): void {
    this.camera.centerOn(x, y);
    this.refresh();
  }

  /** Make the sprites match the camera and the fog; no-op when neither has changed since the last call. */
  refresh(): void {
    const { x, y } = this.camera;
    const version = this.fog?.version() ?? 0;
    const parity = (x + y) & 1;
    const fogChanged = this.fogDrawn?.version !== version || this.fogDrawn.parity !== parity;
    if (this.drawnAt?.x === x && this.drawnAt.y === y) {
      if (fogChanged) this.drawFog(version, parity);
      return;
    }
    this.drawnAt = { x, y };
    this.layer.position.set(-x, -y);

    const { map, ground } = this;
    const view = this.view;
    // A raised tile is drawn higher than its flat place: look for tiles as far below the view as the highest one.
    const reach = ground.flat ? 0 : (ground.maxHeight + 1) * ELEV_H;
    const range = visibleRange({ ...view, h: view.h + reach }, map.width, map.height);
    const wanted = new Set<number>();
    if (range) {
      for (let row = range.row0; row <= range.row1; row++) {
        for (let col = range.col0; col <= range.col1; col++) {
          const box = ground.tileBox(col, row);
          if (box.x < view.x + view.w && box.x + FOG_W > view.x && box.y < view.y + view.h && box.y + box.h + 1 > view.y) wanted.add(row * map.width + col);
        }
      }
    }
    for (const [index, sprite] of this.active) {
      if (wanted.has(index)) continue;
      this.layer.removeChild(sprite);
      this.spare.push(sprite);
      this.active.delete(index);
      this.erasers.get(index)?.destroy();
      this.erasers.delete(index);
    }
    for (const index of wanted) {
      if (this.active.has(index)) continue;
      const col = index % map.width;
      const row = (index - col) / map.width;
      const type = ground.types[index]!;
      const art = this.art.get(map.terrain[index]!)!;
      const frame = art.frames[tilePicture(art, type, col, row)] ?? art.frames[0]!;
      const sprite = this.spare.pop() ?? new Sprite();
      const box = ground.tileBox(col, row);
      sprite.texture = frame.texture;
      sprite.position.set(box.x - frame.hotspotX, box.y - frame.hotspotY);
      // Painter's order: the original scans the screen's rows top to bottom (a flat map keeps rows over earlier rows).
      sprite.zIndex = ground.flat ? index : ground.rank[index]!;
      this.layer.addChild(sprite);
      this.active.set(index, sprite);
      if (!ground.flat && (type !== 0 || map.elevation[index]! > 0)) {
        const eraser = this.fogLayer.addChild(new Sprite(this.eraserTexture(type)));
        eraser.blendMode = 'erase';
        eraser.position.set(box.x, box.y);
        eraser.zIndex = ground.rank[index]! - 0.5;
        this.erasers.set(index, eraser);
      }
    }
    this.drawFog(version, parity);
  }

  /**
   * `view_function_terrain`'s fog (src/view.cpp:1940-2110): an unexplored tile is not drawn (and covered black, for the
   * low objects under the overlay); an explored one gets the fog of its state and the edges of its neighbours. The dots follow the screen (`parity` is the camera's).
   */
  private drawFog(version: number, parity: number): void {
    this.fogDrawn = { version, parity };
    const { map, fog } = this;
    const width = map.width;
    for (const [index, overlay] of this.overlays) {
      if (fog && this.active.has(index)) continue;
      overlay.destroy();
      this.overlays.delete(index);
    }
    if (!fog) {
      for (const sprite of this.active.values()) sprite.visible = true;
      return;
    }
    const visible = (c: number, r: number) => fog.state(c, r) === TILE_VISIBLE;
    const explored = (c: number, r: number) => fog.state(c, r) !== TILE_BLACK;
    for (const [index, sprite] of this.active) {
      const col = index % width;
      const row = (index - col) / width;
      const state = fog.state(col, row);
      sprite.visible = state !== TILE_BLACK;
      const texture = this.fogTexture(
        this.ground.types[index]!,
        state,
        state === TILE_VISIBLE ? edgeNumber(visible, col, row, width, map.height) : 0,
        state === TILE_BLACK ? 0 : edgeNumber(explored, col, row, width, map.height),
        parity,
      );
      let overlay = this.overlays.get(index);
      if (!texture) {
        if (overlay) overlay.visible = false;
        continue;
      }
      if (!overlay) {
        overlay = this.fogLayer.addChild(new Sprite());
        const box = this.ground.tileBox(col, row);
        overlay.position.set(box.x, box.y);
        overlay.zIndex = this.ground.rank[index]!;
        this.overlays.set(index, overlay);
      }
      overlay.texture = texture;
      overlay.visible = true;
    }
  }

  /** The black over a tile of `type` and `state` with these edges, made once per kind; null when nothing is shaded. */
  private fogTexture(type: number, state: number, visibleEdge: number, exploredEdge: number, parity: number): Texture | null {
    const key = `${type}:${state}:${visibleEdge}:${exploredEdge}:${parity}`;
    let texture = this.fogTextures.get(key);
    if (texture !== undefined) return texture;
    const edges = this.edges[type] ?? this.edges[0]!;
    const alpha = fogPixels(edges, state, visibleEdge, exploredEdge, parity, fogHeight(type));
    texture = alpha ? alphaTexture(alpha, fogHeight(type)) : null;
    this.fogTextures.set(key, texture);
    return texture;
  }

  /** The whole drawn shape of tile type `type` (its edge 0 spans), for erasing the overlays it covers. */
  private eraserTexture(type: number): Texture {
    const key = `eraser:${type}`;
    let texture = this.fogTextures.get(key);
    if (texture) return texture;
    const height = fogHeight(type);
    const alpha = new Uint8Array(FOG_W * height);
    for (const [y, x0, x1] of (this.edges[type] ?? this.edges[0]!).normal[0]!) {
      if (y < height) for (let x = Math.max(0, x0); x <= Math.min(FOG_W - 1, x1); x++) alpha[y * FOG_W + x] = 255;
    }
    texture = alphaTexture(alpha, height);
    this.fogTextures.set(key, texture);
    return texture;
  }

  /**
   * The outline of the drawn terrain, the mask of `terrainLayer`: the map's diamond on a flat map. On a map with hills,
   * each tile's surface near the edges (a hill there rises past them) and one diamond inside them: a hill moves the
   * ground drawn at a pixel by at most `maxHeight / 2` tiles, so terrain covers that inner diamond whole.
   */
  private terrainMask(): Graphics {
    const g = new Graphics();
    const { map, ground } = this;
    const diamond = (col0: number, row0: number, col1: number, row1: number) => {
      const left = tileOrigin(col0, row0, map.width);
      const top = tileOrigin(col1, row0, map.width);
      const right = tileOrigin(col1, row1, map.width);
      const bottom = tileOrigin(col0, row1, map.width);
      // The frames' shared right and bottom edge pixels included.
      g.poly([left.x, left.y + 16, top.x + 32, top.y, right.x + 65, right.y + 16, bottom.x + 32, bottom.y + 33]).fill(0xffffff);
    };
    if (ground.flat) {
      diamond(0, 0, map.width - 1, map.height - 1);
      return g;
    }
    const rim = ground.maxHeight + 2;
    if (map.width > 2 * rim && map.height > 2 * rim) diamond(rim, rim, map.width - 1 - rim, map.height - 1 - rim);
    for (let row = 0; row < map.height; row++) {
      for (let col = 0; col < map.width; col++) {
        if (Math.min(col, row, map.width - 1 - col, map.height - 1 - row) > rim) continue;
        const box = ground.tileBox(col, row);
        const [l, t, b, r] = tileCorners(ground.type(col, row)) as [readonly [number, number], readonly [number, number], readonly [number, number], readonly [number, number]];
        g.poly([box.x + t[0], box.y + t[1], box.x + r[0] + 1, box.y + r[1], box.x + b[0], box.y + b[1] + 1, box.x + l[0], box.y + l[1]]).fill(0xffffff);
      }
    }
    return g;
  }

  destroy(): void {
    this.app.ticker.remove(this.tick);
    this.app.renderer.off('resize', this.onResize);
    this.controls.destroy();
    this.app.stage.removeChild(this.layer);
    this.layer.destroy({ children: true });
    for (const texture of this.fogTextures.values()) texture?.destroy(true);
  }
}

/** A black texture of `height` rows by `FOG_W` with alpha `alpha` per pixel. */
function alphaTexture(alpha: Uint8Array, height: number): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = FOG_W;
  canvas.height = height;
  const g = canvas.getContext('2d')!;
  const image = g.createImageData(FOG_W, height);
  alpha.forEach((a, i) => (image.data[i * 4 + 3] = a));
  g.putImageData(image, 0, 0);
  const texture = Texture.from(canvas);
  texture.source.scaleMode = 'nearest';
  return texture;
}
