import { Application, Container, Rectangle, Sprite, Text } from 'pixi.js';
import type { AssetProvider } from './provider';

const MARGIN = 12;
const GAP = 4;
const VILLAGER_SCALE = 3;

export interface DebugViewParams {
  terrainId: number;
  unitId: number;
  owner: number;
}

/** What tests read from `window.__assetsDebug` after the view is drawn. */
export interface DebugViewReport {
  source: AssetProvider['kind'];
  terrainFrames: number;
  /** Screen rectangles of each terrain frame, then the unit sprite, in canvas pixels. */
  terrainRects: Rectangle[];
  unitRect: Rectangle | null;
  /** RGBA of one canvas pixel. */
  pixel(x: number, y: number): [number, number, number, number];
}

export async function renderAssetsDebug(
  app: Application,
  provider: AssetProvider,
  { terrainId, unitId, owner }: DebugViewParams,
): Promise<DebugViewReport> {
  const stage = new Container();
  app.stage.addChild(stage);
  const label = (text: string, x: number, y: number) => {
    const t = new Text({ text, style: { fill: '#e8d9b5', fontSize: 14, fontFamily: 'monospace' } });
    t.position.set(x, y);
    stage.addChild(t);
  };
  label(`assets: ${provider.kind}`, MARGIN, MARGIN);

  const terrain = await provider.terrainFrames(terrainId);
  label(`terrain ${terrainId}: ${terrain.length} frame(s)`, MARGIN, 36);
  const columns = Math.max(1, Math.ceil(Math.sqrt(terrain.length)));
  const terrainRects: Rectangle[] = [];
  let x = MARGIN;
  let y = 60;
  let rowHeight = 0;
  terrain.forEach((frame, i) => {
    const { width, height } = frame.texture;
    if (i > 0 && i % columns === 0) {
      x = MARGIN;
      y += rowHeight + GAP;
      rowHeight = 0;
    }
    const sprite = new Sprite(frame.texture);
    sprite.position.set(x, y);
    stage.addChild(sprite);
    terrainRects.push(new Rectangle(x, y, width, height));
    x += width + GAP;
    rowHeight = Math.max(rowHeight, height);
  });

  let unitRect: Rectangle | null = null;
  const graphic = provider.unitStandingGraphic(unitId);
  const unitFrames = graphic === null ? [] : await provider.graphicFrames(graphic, owner);
  const frame = unitFrames[0];
  label(`unit ${unitId} (graphic ${graphic ?? '-'}): ${unitFrames.length} frame(s)`, 440, 36);
  if (frame) {
    const sprite = new Sprite(frame.texture);
    sprite.scale.set(VILLAGER_SCALE);
    sprite.position.set(520 - frame.hotspotX * VILLAGER_SCALE, 280 - frame.hotspotY * VILLAGER_SCALE);
    stage.addChild(sprite);
    unitRect = new Rectangle(sprite.x, sprite.y, frame.texture.width * VILLAGER_SCALE, frame.texture.height * VILLAGER_SCALE);
  }

  app.render();
  return {
    source: provider.kind,
    terrainFrames: terrain.length,
    terrainRects,
    unitRect,
    pixel(px, py) {
      const { pixels } = app.renderer.extract.pixels({ target: app.stage, frame: new Rectangle(px, py, 1, 1) });
      return [pixels[0] ?? 0, pixels[1] ?? 0, pixels[2] ?? 0, pixels[3] ?? 0];
    },
  };
}
