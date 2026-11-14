import type { Application, Ticker } from 'pixi.js';
import { ATTR_FOOD, ATTR_GOLD, ATTR_STONE, ATTR_WOOD, type World } from '@aoe/sim';

export interface Resources {
  food: number;
  wood: number;
  gold: number;
  stone: number;
}

/** The player's stockpile as the game shows it: whole numbers (`RGE_Player` attributes hold floats). */
export function resourcesOf(world: World, player: number): Resources {
  const a = world.attributes[player]!;
  const whole = (type: number) => Math.floor(a[type] ?? 0);
  return { food: whole(ATTR_FOOD), wood: whole(ATTR_WOOD), gold: whole(ATTR_GOLD), stone: whole(ATTR_STONE) };
}

/** Wood, food, gold and stone counts in the top strip of `parent`, in the original's order; the icons are in the strip's art. */
export class ResourceBar {
  readonly root = document.createElement('div');
  private readonly fields: [keyof Resources, HTMLElement][];
  private readonly tick: (ticker: Ticker) => void;

  constructor(
    parent: HTMLElement,
    private readonly app: Application,
    private readonly world: World,
    private readonly player: number,
  ) {
    this.root.id = 'resource-bar';
    this.root.dataset.testid = 'resource-bar';
    this.fields = (['wood', 'food', 'gold', 'stone'] as const).map((key) => {
      const field = document.createElement('span');
      field.dataset.testid = `res-${key}`;
      const label = document.createElement('span');
      label.textContent = key[0]!.toUpperCase() + key.slice(1);
      const value = document.createElement('b');
      field.append(label, value);
      this.root.append(field);
      return [key, value];
    });
    parent.append(this.root);
    this.tick = () => this.update();
    app.ticker.add(this.tick);
    this.update();
  }

  /** Moves each count to its x (px from the strip's left edge), as `TRIBE_Panel_Inven::draw` does. */
  place(xs: readonly number[]): void {
    this.fields.forEach(([, el], i) => {
      const field = el.parentElement!;
      field.style.left = `${xs[i]}px`;
    });
  }

  private update(): void {
    const r = resourcesOf(this.world, this.player);
    for (const [key, el] of this.fields) {
      const text = String(r[key]);
      if (el.textContent !== text) el.textContent = text;
    }
  }

  destroy(): void {
    this.app.ticker.remove(this.tick);
    this.root.remove();
  }
}
