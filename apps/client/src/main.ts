import './style.css';
import { Application } from 'pixi.js';
import { createAssetProvider } from './assets';
import { renderAssetsDebug, type DebugViewReport } from './assets/debug-view';
import { exposeMapDebug, MapView } from './map';
import { startMultiplayer } from './multiplayer';
import { startSkirmish } from './skirmish';
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
  // Black outside the map, as in the original; the canvas follows the window size.
  await app.init({ resizeTo: window, background: '#000000' });
  app.canvas.dataset.testid = 'game-canvas';
  host.append(app.canvas);
  document.title = GAME_TITLE;

  const params = new URLSearchParams(location.search);
  // The canvas stays hidden behind the lobby until a game starts; the debug views have no lobby.
  const setGameVisible = (visible: boolean) => (host.hidden = !visible);
  setGameVisible(['assets', 'map', 'combat'].includes(params.get('debug') ?? ''));
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

  if (params.get('debug') === 'combat') {
    // A local fight without a lobby (Bowmen, Clubmen, Villagers); `speed` multiplies the pace.
    window.__skirmish = await startSkirmish(app, Number(params.get('speed') ?? 1) || 1);
    return;
  }

  const lobbyHost = document.getElementById('multiplayer');
  if (!lobbyHost) throw new Error('missing #multiplayer element');
  const resources = params.has('resources') ? Number(params.get('resources')) : undefined;
  const bowmen = Number(params.get('bowmen') ?? 0);
  const houses = Number(params.get('houses') ?? 0);
  await startMultiplayer(lobbyHost, app, {
    debug: params.get('debug') === 'net',
    speed: Number(params.get('speed') ?? 1) || 1,
    resources: resources !== undefined && Number.isFinite(resources) ? resources : undefined,
    bowmen: Number.isInteger(bowmen) && bowmen > 0 ? bowmen : undefined,
    market: params.get('market') === '1',
    houses: Number.isInteger(houses) && houses > 0 ? houses : undefined,
    testMap: params.get('map') === 'test',
    seed: params.has('seed') && Number.isInteger(Number(params.get('seed'))) ? Number(params.get('seed')) : undefined,
    perturb: params.has('perturb') && Number.isInteger(Number(params.get('perturb'))) ? Number(params.get('perturb')) : undefined,
    setGameVisible,
  });
}

void main();
