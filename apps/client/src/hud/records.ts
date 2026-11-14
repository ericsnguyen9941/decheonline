// Which dat record a player's master shows in the HUD. A player's masters are copies of its civ's records that techs
// change; an upgrade (`copy_obj`, effect type 3) makes master `dest` a whole copy of `source` under `dest`'s id, so its
// name, icon and panel values are the source's from then on (the Tool Age House is House1's copy: icon 16, not 15).
// The sim's record keeps the source's dat name and sprites but not its id; the source is the table's record with that
// name and standing sprite.
import { UNIT_TYPES, type UnitType } from '@aoe/sim';
import type { AssetProvider, UnitInfo } from '../assets';

const sources = new Map<string, number>();

/** The dat id whose interface fields (name, icon, button, panel values) master `t` carries. */
export function sourceId(t: UnitType): number {
  const own = UNIT_TYPES.get(t.id);
  if (!own || (own.name === t.name && own.standing.graphic === t.standing.graphic)) return t.id;
  const key = `${t.id}:${t.name}:${t.standing.graphic}`;
  let id = sources.get(key);
  if (id === undefined) {
    id = [...UNIT_TYPES.values()].find((o) => o.name === t.name && o.standing.graphic === t.standing.graphic)?.id ?? t.id;
    sources.set(key, id);
  }
  return id;
}

/** The pack's numbers for what master `t` shows. */
export function infoOf(provider: AssetProvider, t: UnitType): UnitInfo | null {
  return provider.unitInfo(sourceId(t));
}
