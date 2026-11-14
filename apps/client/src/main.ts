import { Application } from 'pixi.js';
import { createAssetProvider } from './assets';
import { renderAssetsDebug, type DebugViewReport } from './assets/debug-view';
import { exposeMapDebug, MapView } from './map';
import { startMultiplayer } from './multiplayer';
import { createTestMap } from '@aoe/sim';
import { GAME_TITLE } from './title';

declare global {
  interface Window {
    __assetsDebug?: DebugViewReport;
  }
}

async function main(): Promise<void> {
  const host = document.getElementById('game');
  if (!host) throw new Error('missing #game element');

  const app = new Application();
  await app.init({ width: 800, height: 450, background: '#2d3b1f' });
  app.canvas.dataset.testid = 'game-canvas';
  host.append(app.canvas);
  document.title = GAME_TITLE;

  const params = new URLSearchParams(location.search);
  if (params.get('debug') === 'assets') {
    // Unit 83 is the villager in the shipped dat; terrain 0 is Grass.
    const view = await renderAssetsDebug(app, await createAssetProvider(), {
      terrainId: Number(params.get('terrain') ?? 0),
      unitId: Number(params.get('unit') ?? 83),
      owner: Number(params.get('owner') ?? 1),
    });
    window.__assetsDebug = view;
    app.canvas.dataset.assetsSource = view.source;
    return;
  }

  if (params.get('debug') === 'map') {
    // The fixed test map without a lobby; `col` and `row` pick the tile in the middle of the view.
    const view = await MapView.create(app, createTestMap(), await createAssetProvider());
    const debug = exposeMapDebug(view);
    if (params.has('col') && params.has('row')) debug.centerOnTile(Number(params.get('col')), Number(params.get('row')));
    app.canvas.dataset.assetsSource = view.source;
    return;
  }

  const lobbyHost = document.getElementById('multiplayer');
  if (!lobbyHost) throw new Error('missing #multiplayer element');
  await startMultiplayer(lobbyHost, app, { debug: params.get('debug') === 'net', speed: Number(params.get('speed') ?? 1) || 1 });
}

void main();
