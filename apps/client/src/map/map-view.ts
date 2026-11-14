import { Container, Sprite, Texture, type Application, type Ticker } from 'pixi.js';
import type { TileMap } from '@aoe/sim';
import type { PackTileEdges } from '@aoe/assets-import/manifest';
import { DebugProvider } from '../assets/debug-provider';
import type { AssetProvider, SpriteFrame } from '../assets';
import { Camera, CameraControls } from './camera';
import { edgeNumber, FOG_H, FOG_W, fogPixels, PLAIN_EDGES, TILE_BLACK, TILE_VISIBLE } from './fog';
import { mapPixelSize, tileOrigin, tileTouches, visibleRange, type Rect } from './iso';

/** What the fog is drawn from: one player's knowledge of the tiles. */
export interface FogSource {
  /** `TILE_VISIBLE`, `TILE_FOGGED` or `TILE_BLACK` (`get_visible`). */
  state(col: number, row: number): number;
  /** Changes whenever `state` may have changed (each sim step). */
  version(): number;
}

interface TerrainArt {
  frames: SpriteFrame[];
  rows: number;
  cols: number;
}

/**
 * Draws a `TileMap` as flat isometric tiles in `app.stage`, scrolled by a `Camera`. Only tiles that touch the
 * viewport have sprites. Each tile picks its variant frame like the original (`RGE_View::get_tile_picture`).
 * With a `FogSource` (`setFog`) unexplored tiles are left black and fogged ones and the edges are shaded (`fog.ts`).
 */
export class MapView {
  readonly camera: Camera;
  readonly layer = new Container();
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
  private readonly fogTextures = new Map<string, Texture | null>();

  private constructor(
    private readonly app: Application,
    readonly map: TileMap,
    private readonly art: Map<number, TerrainArt>,
    readonly source: AssetProvider['kind'],
    private readonly edges: PackTileEdges,
  ) {
    this.camera = new Camera(map.width, map.height, app.screen.width, app.screen.height);
    this.layer.sortableChildren = true;
    this.fogLayer.zIndex = map.width * map.height - 0.5;
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

    const { map } = this;
    const view = this.view;
    const range = visibleRange(view, map.width, map.height);
    const wanted = new Set<number>();
    if (range) {
      for (let row = range.row0; row <= range.row1; row++) {
        for (let col = range.col0; col <= range.col1; col++) {
          if (tileTouches(view, col, row, map.width)) wanted.add(row * map.width + col);
        }
      }
    }
    for (const [index, sprite] of this.active) {
      if (wanted.has(index)) continue;
      this.layer.removeChild(sprite);
      this.spare.push(sprite);
      this.active.delete(index);
    }
    for (const index of wanted) {
      if (this.active.has(index)) continue;
      const col = index % map.width;
      const row = (index - col) / map.width;
      const art = this.art.get(map.terrain[index]!)!;
      const frame = art.frames[(row % art.rows) * art.cols + (col % art.cols)] ?? art.frames[0]!;
      const sprite = this.spare.pop() ?? new Sprite();
      const origin = tileOrigin(col, row, map.width);
      sprite.texture = frame.texture;
      sprite.position.set(origin.x - frame.hotspotX, origin.y - frame.hotspotY);
      // Painter's order: later rows over earlier ones, as the original draws them.
      sprite.zIndex = index;
      this.layer.addChild(sprite);
      this.active.set(index, sprite);
    }
    this.drawFog(version, parity);
  }

  /**
   * `view_function_terrain`'s fog (src/view.cpp:1940-2110): an unexplored tile is not drawn; an explored one gets the
   * fog of its state and the edges of its neighbours. The dots follow the screen (`parity` is the camera's).
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
      const texture =
        state === TILE_BLACK
          ? null
          : this.fogTexture(
              state,
              state === TILE_VISIBLE ? edgeNumber(visible, col, row, width, map.height) : 0,
              edgeNumber(explored, col, row, width, map.height),
              parity,
            );
      let overlay = this.overlays.get(index);
      if (!texture) {
        if (overlay) overlay.visible = false;
        continue;
      }
      if (!overlay) {
        overlay = this.fogLayer.addChild(new Sprite());
        const origin = tileOrigin(col, row, width);
        overlay.position.set(origin.x, origin.y);
        this.overlays.set(index, overlay);
      }
      overlay.texture = texture;
      overlay.visible = true;
    }
  }

  /** The black over a tile of `state` with these edges, made once per kind; null when nothing is shaded. */
  private fogTexture(state: number, visibleEdge: number, exploredEdge: number, parity: number): Texture | null {
    const key = `${state}:${visibleEdge}:${exploredEdge}:${parity}`;
    let texture = this.fogTextures.get(key);
    if (texture !== undefined) return texture;
    const alpha = fogPixels(this.edges, state, visibleEdge, exploredEdge, parity);
    texture = null;
    if (alpha) {
      const canvas = document.createElement('canvas');
      canvas.width = FOG_W;
      canvas.height = FOG_H;
      const g = canvas.getContext('2d')!;
      const image = g.createImageData(FOG_W, FOG_H);
      alpha.forEach((a, i) => (image.data[i * 4 + 3] = a));
      g.putImageData(image, 0, 0);
      texture = Texture.from(canvas);
      texture.source.scaleMode = 'nearest';
    }
    this.fogTextures.set(key, texture);
    return texture;
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
