import { Container, Sprite, type Application, type Ticker } from 'pixi.js';
import type { TileMap } from '@aoe/sim';
import { DebugProvider } from '../assets/debug-provider';
import type { AssetProvider, SpriteFrame } from '../assets';
import { Camera, CameraControls } from './camera';
import { mapPixelSize, tileOrigin, tileTouches, visibleRange, type Rect } from './iso';

interface TerrainArt {
  frames: SpriteFrame[];
  rows: number;
  cols: number;
}

/**
 * Draws a `TileMap` as flat isometric tiles in `app.stage`, scrolled by a `Camera`. Only tiles that touch the
 * viewport have sprites. Each tile picks its variant frame like the original (`RGE_View::get_tile_picture`).
 */
export class MapView {
  readonly camera: Camera;
  readonly layer = new Container();
  private readonly controls: CameraControls;
  private readonly active = new Map<number, Sprite>();
  private readonly spare: Sprite[] = [];
  private readonly tick: (ticker: Ticker) => void;
  private drawnAt: { x: number; y: number } | null = null;

  private constructor(
    private readonly app: Application,
    readonly map: TileMap,
    private readonly art: Map<number, TerrainArt>,
    readonly source: AssetProvider['kind'],
  ) {
    this.camera = new Camera(map.width, map.height, app.screen.width, app.screen.height);
    this.layer.sortableChildren = true;
    app.stage.addChild(this.layer);
    this.controls = new CameraControls(this.camera, app.canvas);
    this.tick = (ticker) => {
      this.controls.update(ticker.deltaMS);
      this.refresh();
    };
    app.ticker.add(this.tick);
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
    return new MapView(app, map, art, provider.kind);
  }

  /** Map pixel rectangle the camera shows. */
  get view(): Rect {
    return { x: this.camera.x, y: this.camera.y, w: this.camera.viewW, h: this.camera.viewH };
  }

  /** Tiles that currently have a sprite. */
  get drawnTiles(): number {
    return this.active.size;
  }

  /** Move the camera so map pixel `(x, y)` is at the viewport centre. */
  centerOn(x: number, y: number): void {
    this.camera.centerOn(x, y);
    this.refresh();
  }

  /** Make the sprites match the camera; no-op when it has not moved since the last call. */
  refresh(): void {
    const { x, y } = this.camera;
    if (this.drawnAt?.x === x && this.drawnAt.y === y) return;
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
  }

  destroy(): void {
    this.app.ticker.remove(this.tick);
    this.controls.destroy();
    this.app.stage.removeChild(this.layer);
    this.layer.destroy({ children: true });
  }
}
