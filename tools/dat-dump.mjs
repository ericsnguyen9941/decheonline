// Prints records from AOE1_DIR/data2/empires.dat via @aoe/data, no vitest.
// Usage: AOE1_DIR=<install> npm run dat:dump -- <unit|tech|graphic|terrain|effect|civ|sound> <id> [civ=1]
//   (unit takes an optional civ id; Gaia is 0). `summary` prints table sizes.
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// @aoe/data imports extensionless ('./dat'); Node needs a hook to resolve them.
const hook = `export async function resolve(s, c, n) {
  try { return await n(s, c); } catch (e) {
    if (e.code === 'ERR_MODULE_NOT_FOUND' && s.startsWith('.')) return n(s + '.ts', c);
    throw e;
  }
}`;
register('data:text/javascript,' + encodeURIComponent(hook), import.meta.url);

const dir = process.env.AOE1_DIR;
const [kind, idArg, civArg] = process.argv.slice(2);
if (!dir || !kind) {
  console.error('usage: AOE1_DIR=<install> npm run dat:dump -- <summary|unit|tech|graphic|terrain|effect|civ|sound> [id] [civ]');
  process.exit(1);
}
const { RuleSet } = await import(pathToFileURL(join(import.meta.dirname, '..', 'packages', 'data', 'src', 'index.ts')).href);
const rules = RuleSet.fromFile(readFileSync(join(dir, 'data2', 'empires.dat')));
const dat = rules.dat;

const tables = {
  tech: dat.techs, graphic: dat.graphics, effect: dat.effects, civ: dat.civs,
  terrain: dat.terrainBlock.terrains, sound: dat.sounds,
};
let record;
if (kind === 'summary') {
  record = { version: dat.version, civs: dat.civs.length, techs: dat.techs.length, graphics: dat.graphics.length, effects: dat.effects.length, sounds: dat.sounds.length };
} else if (kind === 'unit') {
  record = rules.unit(Number(civArg ?? 1), Number(idArg));
} else if (tables[kind]) {
  record = tables[kind][Number(idArg)];
} else {
  console.error(`unknown kind ${kind}`);
  process.exit(1);
}
if (record === undefined || record === null) {
  console.error(`${kind} ${idArg}: no such record`);
  process.exit(1);
}
const compact = (k, v) => (Array.isArray(v) && v.length > 40 ? `[${v.length} items]` : v);
console.log(JSON.stringify(record, compact, 2));
