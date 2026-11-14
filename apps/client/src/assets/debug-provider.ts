import { Texture } from 'pixi.js';
import type { AssetProvider, GraphicInfo, SpriteFrame } from './provider';

const OWNER_COLOURS = ['#808080', '#3b6fd8', '#d83b3b', '#3bb54a', '#d8c43b', '#3bc4c4', '#a43bd8', '#8a8a8a', '#e8892b'];

function draw(width: number, height: number, paint: (g: CanvasRenderingContext2D) => void): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  paint(canvas.getContext('2d') as CanvasRenderingContext2D);
  return Texture.from(canvas);
}

/** Flat shapes standing in for the art: a coloured diamond per terrain, a stick figure per unit. */
export class DebugProvider implements AssetProvider {
  readonly kind = 'debug';

  unitStandingGraphic(unitId: number): number | null {
    return unitId;
  }

  graphicInfo(): GraphicInfo | null {
    return null;
  }

  async graphicFrames(_graphicId: number, owner = 1): Promise<SpriteFrame[]> {
    const colour = OWNER_COLOURS[owner] ?? OWNER_COLOURS[1]!;
    const texture = draw(20, 36, (g) => {
      g.fillStyle = colour;
      g.fillRect(5, 12, 10, 18);
      g.fillStyle = '#e8c9a0';
      g.beginPath();
      g.arc(10, 7, 6, 0, Math.PI * 2);
      g.fill();
    });
    return [{ texture, hotspotX: 10, hotspotY: 32 }];
  }

  terrainLayout(): { rows: number; cols: number } {
    return { rows: 1, cols: 1 };
  }

  async terrainFrames(terrainId: number): Promise<SpriteFrame[]> {
    const texture = draw(65, 33, (g) => {
      g.fillStyle = `hsl(${(terrainId * 47) % 360} 45% 38%)`;
      g.beginPath();
      g.moveTo(32, 0);
      g.lineTo(64, 16);
      g.lineTo(32, 32);
      g.lineTo(0, 16);
      g.closePath();
      g.fill();
    });
    return [{ texture, hotspotX: 0, hotspotY: 0 }];
  }
}
