import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, expect, firefox, test, webkit, type BrowserType } from '@playwright/test';
import { runReplay, sampleReplay } from '@aoe/sim';

// One replay must hash the same on every JS engine: float32 math and the CRT rand() port are only
// deterministic if V8 (Node, Chromium), SpiderMonkey (Firefox) and JavaScriptCore (WebKit) agree bit for bit.
const simEntry = fileURLToPath(new URL('../../packages/sim/src/index.ts', import.meta.url));

// Playwright's Firefox (v1572) does not start on macOS 27 ("Could not find profile folder"; AGENTS.md Traps). Only there
// is it skipped, loudly; on Linux (the docker image) a Firefox that fails to launch fails the test.
const firefoxBroken = process.platform === 'darwin';

test('sample replay gives the same hashes in Node, Chromium, Firefox and WebKit', async () => {
  if (firefoxBroken) {
    test.info().annotations.push({ type: 'skipped-engine', description: 'firefox: cannot launch on macOS; run this test in the Linux image' });
    console.warn('determinism: SKIPPING firefox on macOS (cannot launch); node, chromium and webkit are compared');
  }
  const bundle = await build({ entryPoints: [simEntry], bundle: true, format: 'iife', globalName: 'AoeSim', write: false });
  const script = bundle.outputFiles[0]!.text;

  const results: Record<string, number[]> = { node: runReplay(sampleReplay()) };
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
        return sim.runReplay(sim.sampleReplay());
      });
    } finally {
      await browser.close();
    }
  }

  for (const [name, hashes] of Object.entries(results)) {
    console.log(`${name}: final hash ${hashes.at(-1)!.toString(16).padStart(8, '0')} after ${hashes.length} turns`);
  }
  for (const hashes of Object.values(results)) expect(hashes).toEqual(results['node']);
});
