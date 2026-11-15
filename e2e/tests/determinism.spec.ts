import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, expect, firefox, test, webkit, type BrowserType } from '@playwright/test';
import { runReplay, sampleDiplomacyReplay, sampleLobbyReplay, sampleNavalReplay, samplePriestReplay, sampleRandomMapReplay, sampleReplay, sampleSiegeReplay, sampleTradeReplay, sampleTransportReplay } from '@aoe/sim';

// Each replay must hash the same on every JS engine: float32 math and the CRT rand() port are only
// deterministic if V8 (Node, Chromium), SpiderMonkey (Firefox) and JavaScriptCore (WebKit) agree bit for bit. The second
// replay is a random map game: the map generator (sqrt, float32 tables) runs in every engine too. The third is a random
// map game on lobby settings other than the defaults (map type and size, a Random civ, a time limit). The fourth changes
// stances and allied victory and sends tribute (sampleDiplomacyReplay). The fifth throws stones and bolts at the ground and
// splashes (sampleSiegeReplay). The sixth converts and heals with Priests (samplePriestReplay). The seventh fishes, fights
// and repairs boats on a shore map (sampleNavalReplay). The eighth boards transports, crosses, drops, unloads and sinks
// them (sampleTransportReplay). The ninth trades between two Docks for gold (sampleTradeReplay).
const simEntry = fileURLToPath(new URL('../../packages/sim/src/index.ts', import.meta.url));

// Playwright's Firefox (v1572) does not start on macOS 27 ("Could not find profile folder"; AGENTS.md Traps). Only there
// is it skipped, loudly; on Linux (the docker image) a Firefox that fails to launch fails the test.
const firefoxBroken = process.platform === 'darwin';

test('sample replays (test map, random map, lobby settings, diplomacy, siege, priests, naval, transport, trade) give the same hashes in Node, Chromium, Firefox and WebKit', async () => {
  if (firefoxBroken) {
    test.info().annotations.push({ type: 'skipped-engine', description: 'firefox: cannot launch on macOS; run this test in the Linux image' });
    console.warn('determinism: SKIPPING firefox on macOS (cannot launch); node, chromium and webkit are compared');
  }
  const bundle = await build({ entryPoints: [simEntry], bundle: true, format: 'iife', globalName: 'AoeSim', write: false });
  const script = bundle.outputFiles[0]!.text;

  const results: Record<string, number[][]> = { node: [runReplay(sampleReplay()), runReplay(sampleRandomMapReplay()), runReplay(sampleLobbyReplay()), runReplay(sampleDiplomacyReplay()), runReplay(sampleSiegeReplay()), runReplay(samplePriestReplay()), runReplay(sampleNavalReplay()), runReplay(sampleTransportReplay()), runReplay(sampleTradeReplay())] };
  const engines: [string, BrowserType][] = [
    ['chromium', chromium],
    ['firefox', firefox],
    ['webkit', webkit],
  ];
  for (const [name, engine] of engines) {
    if (name === 'firefox' && firefoxBroken) continue;
    const browser = await engine.launch();
    try {
      const page = await browser.newPage();
      await page.addScriptTag({ content: script });
      results[name] = await page.evaluate(() => {
        const sim = (globalThis as unknown as { AoeSim: typeof import('@aoe/sim') }).AoeSim;
        return [sim.runReplay(sim.sampleReplay()), sim.runReplay(sim.sampleRandomMapReplay()), sim.runReplay(sim.sampleLobbyReplay()), sim.runReplay(sim.sampleDiplomacyReplay()), sim.runReplay(sim.sampleSiegeReplay()), sim.runReplay(sim.samplePriestReplay()), sim.runReplay(sim.sampleNavalReplay()), sim.runReplay(sim.sampleTransportReplay()), sim.runReplay(sim.sampleTradeReplay())];
      });
    } finally {
      await browser.close();
    }
  }

  const hex = (hashes: number[]) => `${hashes.at(-1)!.toString(16).padStart(8, '0')} after ${hashes.length} turns`;
  for (const [name, [fixed, random, lobby, diplomacy, siege, priests, naval, transport, trade]] of Object.entries(results)) {
    console.log(`${name}: final hash ${hex(fixed!)} (test map), ${hex(random!)} (random map), ${hex(lobby!)} (lobby settings), ${hex(diplomacy!)} (diplomacy, tribute), ${hex(siege!)} (siege, blast), ${hex(priests!)} (priests), ${hex(naval!)} (naval), ${hex(transport!)} (transport), ${hex(trade!)} (trade)`);
  }
  for (const hashes of Object.values(results)) expect(hashes).toEqual(results['node']);
});
