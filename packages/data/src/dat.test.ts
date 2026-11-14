import { describe, expect, test } from 'vitest';
import { parseDat, parseDatBytes, serializeDatBytes, writeDat } from './dat';
import { RuleSet } from './rules';
import { buildSyntheticDat } from './synthetic';
import { UnitType } from './types';

describe('synthetic dat', () => {
  test('round-trips through the on-disk format', () => {
    const dat = buildSyntheticDat();
    const file = writeDat(dat);
    expect(parseDat(file)).toEqual(dat);
  });

  test('serializes deterministically', () => {
    const bytes = serializeDatBytes(buildSyntheticDat());
    expect(serializeDatBytes(parseDatBytes(bytes))).toEqual(bytes);
  });

  test('covers every unit section and a graphic hole', () => {
    const dat = parseDat(writeDat(buildSyntheticDat()));
    const units = dat.civs[1]!.units;
    expect(units.map((u) => u?.type ?? null)).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, null]);
    const building = units.find((u) => u?.type === UnitType.Building)!;
    expect(building.creatable?.costs[0]).toEqual({ type: 0, amount: 50, flag: 1 });
    expect(building.building?.techId).toBe(-1);
    expect(units.find((u) => u?.type === UnitType.Projectile)!.projectile?.projectileArc).toBe(0.25);
    expect(units.find((u) => u?.type === UnitType.Tree)!.speed).toBeUndefined();
    expect(dat.graphics[1]).toBeNull();
    expect(dat.graphics[0]!.angleSounds).toHaveLength(2);
  });
});

describe('errors', () => {
  test('rejects trailing bytes', () => {
    const bytes = serializeDatBytes(buildSyntheticDat());
    const longer = new Uint8Array(bytes.length + 3);
    longer.set(bytes);
    expect(() => parseDatBytes(longer)).toThrow(/3 bytes left/);
  });

  test('rejects a truncated file', () => {
    const bytes = serializeDatBytes(buildSyntheticDat());
    expect(() => parseDatBytes(bytes.subarray(0, bytes.length - 1))).toThrow(/past end/);
  });

  test('rejects another dat version', () => {
    const bytes = serializeDatBytes(buildSyntheticDat());
    bytes.set([...'VER 5.7'].map((c) => c.charCodeAt(0)));
    expect(() => parseDatBytes(bytes)).toThrow(/unsupported version "VER 5.7"/);
  });

  test('refuses values the file cannot hold', () => {
    const notFloat32 = buildSyntheticDat();
    notFloat32.civs[1]!.resources[0] = 0.1;
    expect(() => writeDat(notFloat32)).toThrow(/not a float32/);
    const tooBig = buildSyntheticDat();
    tooBig.techs[0]!.researchTime = 40000;
    expect(() => writeDat(tooBig)).toThrow(/does not fit i16/);
    const hole = buildSyntheticDat();
    hole.graphicPointers[1] = 1;
    expect(() => writeDat(hole)).toThrow(/null exactly when its pointer is 0/);
  });
});

describe('RuleSet', () => {
  const rules = RuleSet.fromFile(writeDat(buildSyntheticDat()));

  test('looks records up by id', () => {
    expect(rules.playableCivs.map((c) => c.name)).toEqual(['Alpha', 'Beta']);
    expect(rules.unit(2, 6).name).toBe('Beta unit 70');
    expect(rules.findUnit(2, 9)).toBeNull();
    expect(rules.findUnit(2, 99)).toBeNull();
    expect(rules.tech(0).name).toBe('Tool Age');
    expect(rules.effect(rules.tech(0).effectId).commands[0]).toEqual({ type: 4, a: 0, b: -1, c: 0, d: 2 });
    expect(rules.graphic(2).name).toBe('Arrow');
    expect(rules.sound(0).items[0]!.fileName).toBe('click.wav');
    expect(rules.terrain(1).name).toBe('Terrain 1');
    expect(rules.terrainRestriction(1).accessible).toEqual([1, 0.5]);
    expect(rules.randomMap(1).units[0]!.objectsPerGroup).toBe(5);
  });

  test('throws on missing ids', () => {
    expect(() => rules.unit(1, 9)).toThrow(/unit 9 does not exist for civ 1/);
    expect(() => rules.graphic(1)).toThrow(/graphic 1/);
    expect(() => rules.terrain(2)).toThrow(/terrain 2/);
    expect(() => rules.civ(3)).toThrow(/civ 3/);
    expect(() => rules.randomMap(7)).toThrow(/random map 7/);
  });
});
