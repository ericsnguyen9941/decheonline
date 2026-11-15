import { UNIT_TYPES } from '@aoe/sim';
import { Texture } from 'pixi.js';
import type { AssetProvider, GraphicInfo, SpriteFrame } from './provider';

const OWNER_COLOURS = ['#808080', '#3b6fd8', '#d83b3b', '#3bb54a', '#d8c43b', '#3bc4c4', '#a43bd8', '#8a8a8a', '#e8892b'];

/** The shape as an image bitmap: a canvas texture reads back opaque (`extract.pixels`), a bitmap one keeps its alpha as the pack's do. */
async function draw(width: number, height: number, paint: (g: CanvasRenderingContext2D) => void): Promise<Texture> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  paint(canvas.getContext('2d') as CanvasRenderingContext2D);
  return Texture.from(await createImageBitmap(canvas));
}

/**
 * A building's art: a block with a see-through window around its anchor (the hotspot), as the Stone Age Town Center's
 * sparse art is, so only a pick that counts the row's gaps (`sprite_check`) hits the anchor.
 */
const BUILDING = { width: 96, height: 64, hotspotX: 48, hotspotY: 32, window: 12 };

/** The graphics of the sim's buildings (standing, falling, under construction): the ones drawn as a block. */
const BUILDING_GRAPHICS = new Set<number>();
for (const t of UNIT_TYPES.values()) {
  if (t.masterType !== 80) continue;
  for (const s of [t.standing, t.dying, t.building?.construction]) if (s) BUILDING_GRAPHICS.add(s.graphic);
}

/** Flat shapes standing in for the art: a coloured diamond per terrain, a stick figure per unit, a holed block per building. */
export class DebugProvider implements AssetProvider {
  readonly kind = 'debug';

  unitStandingGraphic(unitId: number): number | null {
    return unitId;
  }

  graphicInfo(): GraphicInfo | null {
    return null;
  }

  async graphicFrames(graphicId: number, owner = 1): Promise<SpriteFrame[]> {
    const colour = OWNER_COLOURS[owner] ?? OWNER_COLOURS[1]!;
    if (BUILDING_GRAPHICS.has(graphicId)) {
      const { width, height, hotspotX, hotspotY, window } = BUILDING;
      const texture = await draw(width, height, (g) => {
        g.fillStyle = colour;
        g.fillRect(0, 0, width, height);
        g.clearRect(hotspotX - window, hotspotY - window, 2 * window, 2 * window);
      });
      return [{ texture, hotspotX, hotspotY }];
    }
    const texture = await draw(20, 36, (g) => {
      g.fillStyle = colour;
      g.fillRect(5, 12, 10, 18);
      g.fillStyle = '#e8c9a0';
      g.beginPath();
      g.arc(10, 7, 6, 0, Math.PI * 2);
      g.fill();
    });
    return [{ texture, hotspotX: 10, hotspotY: 32 }];
  }

  interfaceFrame(): null {
    return null;
  }

  unitInfo(): null {
    return null;
  }

  techInfo(): null {
    return null;
  }

  string(): null {
    return null;
  }

  mapArt(): null {
    return null;
  }

  soundTable(): null {
    return null;
  }

  terrainLayout(): { rows: number; cols: number } {
    return { rows: 1, cols: 1 };
  }

  async terrainFrames(terrainId: number): Promise<SpriteFrame[]> {
    const texture = await draw(65, 33, (g) => {
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
