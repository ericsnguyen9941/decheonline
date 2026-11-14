import type { Application } from 'pixi.js';
import { createAssetProvider } from './assets';
import { Lockstep, showEndDialog } from './lockstep';
import { LobbyView, Session } from './lobby';
import { exposeMapDebug, MapView } from './map';
import { tileCoordsToPixel } from './map/iso';
import { GameHud } from './hud/game-hud';
import { resourcesOf, type Resources } from './hud/resource-bar';
import { connect } from './net/link';
import { isUnit, UnitLayer } from './units/unit-layer';

/** What `?debug=net` exposes as `window.__game`, for tests and manual poking. */
export interface NetDebug {
  /** Queue a `test` command from this client. */
  issueTest(x: number, y: number): void;
  /** Next turn to execute (== turns executed so far). */
  turn(): number;
  hash(turn: number): number | undefined;
  /** Commands applied so far, from each slot. */
  applied(): { type: string }[][];
  /** Entities made by `test` commands (no sprite), by owner. */
  entityOwners(): number[];
  /** Sim player number of this client. */
  player(): number;
  /** Units in the sim, in id order; `col`/`row` is the tile under the unit. */
  units(): DebugUnit[];
  /** Queue a move order for `units` to tile coordinates (x, y), as a right click would. */
  issueMove(units: number[], x: number, y: number): void;
  /** Ids the selection holds; null before the map is drawn. */
  selection(): number[] | null;
  /** Canvas pixel where unit `id` stands, as drawn now; null before the map is drawn. */
  unitScreenPos(id: number): { x: number; y: number } | null;
  /** Objects drawn with pack sprites (not debug shapes). */
  packSprites(): number;
  /** Stockpile of `player` (default: this client's), whole numbers as the resource bar shows them. */
  resources(player?: number): Resources;
  /** Every sim object with a sprite (units, buildings, trees, mines, animals, carcasses), in id order. */
  objects(): DebugObject[];
  /** Stockpile of `player` right after turn `turn` ran, as logged by this client; undefined before that. */
  resourcesAt(turn: number, player: number): Resources | undefined;
  /** Queue a work order for `units` on object `target`, clicked at tile coordinates (x, y). */
  issueWork(units: number[], target: number, x: number, y: number): void;
  /** Canvas pixel at the middle of object `id`'s drawn sprite; null when it is not drawn. */
  objectScreenPos(id: number): { x: number; y: number } | null;
}

export interface DebugObject {
  id: number;
  owner: number;
  type: number;
  x: number;
  y: number;
  /** `object_state`. */
  state: number;
  /** Resource held (`attribute_type_held`, -1 none) and its amount. */
  heldType: number;
  heldAmount: number;
  /** Dat graphic of the active sprite and its frame in the sim. */
  graphic: number;
  frame: number;
}

export interface DebugUnit {
  id: number;
  owner: number;
  type: number;
  x: number;
  y: number;
  col: number;
  row: number;
  facet: number;
  moving: boolean;
}

declare global {
  interface Window {
    __game?: NetDebug;
  }
}

export interface MultiplayerOptions {
  /** Expose debug hooks and the debug panel. */
  debug: boolean;
  /** Lockstep pace multiplier; 1 is the original's speed. */
  speed: number;
  /** Show or hide the game canvas: hidden in the lobby, shown while a game runs. */
  setGameVisible(visible: boolean): void;
}

/** Connects to the relay, shows the lobby in `host`, and runs lockstep once the game starts, drawing the map in `app`. */
export async function startMultiplayer(host: HTMLElement, app: Application, { debug, speed, setGameVisible }: MultiplayerOptions): Promise<void> {
  const link = await connect();
  const session = new Session(link);
  const view = new LobbyView(session);
  host.append(view.root);

  let lockstep: Lockstep | undefined;
  let panel: HTMLElement | undefined;
  let mapView: MapView | undefined;
  let units: UnitLayer | undefined;
  let hud: GameHud | undefined;

  const end = (kind: 'desync' | 'peer-left', detail: string) => {
    lockstep?.stop();
    lockstep = undefined;
    panel?.remove();
    units?.destroy();
    units = undefined;
    hud?.destroy();
    hud = undefined;
    mapView?.destroy();
    mapView = undefined;
    window.__game = undefined;
    window.__map = undefined;
    setGameVisible(false);
    session.finish();
    showEndDialog(kind, detail, () => undefined);
  };

  session.onStart = (start, you) => {
    const player = you + 1;
    const game = new Lockstep({
      link,
      speed,
      start: { seed: start.seed, turnMs: start.turnMs, commandDelay: start.commandDelay, playerCount: start.players.length },
    });
    lockstep = game;
    setGameVisible(true);
    game.onDesync = (turn) => end('desync', `The two games disagreed at turn ${turn}. The game cannot continue.`);
    game.onEnded = () => end('peer-left', 'Your opponent left the game.');
    if (debug) panel = debugPanel(host, game, player, () => units);
    void createAssetProvider().then(async (provider) => {
      const view = await MapView.create(app, game.world.map, provider);
      if (lockstep !== game) return view.destroy();
      mapView = view;
      units = new UnitLayer({ app, view, world: game.world, provider, player, issue: (c) => game.issue(c), turnMs: (t) => game.turnMs(t) });
      hud = new GameHud({ parent: app.canvas.parentElement!, app, world: game.world, provider, player, selection: () => units?.selected ?? new Set() });
      // Start looking at this player's town centre spot.
      const own = units.ownUnits()[0];
      if (own) {
        const p = tileCoordsToPixel(own.x, own.y, game.world.map.width);
        view.centerOn(p.x, p.y);
      }
      if (debug) exposeMapDebug(view);
    });
  };
}

function debugPanel(host: HTMLElement, game: Lockstep, player: number, layer: () => UnitLayer | undefined): HTMLElement {
  const panel = document.createElement('div');
  panel.dataset.testid = 'net-debug';
  const status = document.createElement('span');
  status.dataset.testid = 'net-status';
  const button = document.createElement('button');
  button.dataset.testid = 'send-test';
  button.textContent = 'Send test command';
  let n = 0;
  const issue = (x: number, y: number) => game.issue({ type: 'test', x, y });
  button.addEventListener('click', () => issue(10 + n++, 20));
  const stock = new Map<number, Resources[]>();
  game.onTurn = (turn, hash) => {
    status.textContent = `turn ${turn} hash ${hash}`;
    stock.set(turn, Array.from({ length: game.world.players }, (_, p) => resourcesOf(game.world, p)));
  };
  panel.append(status, button);
  host.append(panel);
  window.__game = {
    issueTest: issue,
    turn: () => game.turn,
    hash: (turn) => game.hashes.get(turn),
    applied: () => game.applied,
    entityOwners: () => [...game.world.entities.all()].filter((e) => !e.sprite).map((e) => e.owner),
    player: () => player,
    units: () =>
      [...game.world.entities.all()]
        .filter(isUnit)
        .map((e) => ({
          id: e.id,
          owner: e.owner,
          type: e.type,
          x: e.x,
          y: e.y,
          col: Math.floor(e.x),
          row: Math.floor(e.y),
          facet: e.mover!.facet,
          moving: e.mover!.action !== null,
        })),
    issueMove: (units, x, y) => game.issue({ type: 'move', units, x, y }),
    selection: () => {
      const l = layer();
      return l ? [...l.selected] : null;
    },
    unitScreenPos: (id) => layer()?.screenPos(id) ?? null,
    packSprites: () => layer()?.packSprites ?? 0,
    resources: (p = player) => resourcesOf(game.world, p),
    resourcesAt: (turn, p) => stock.get(turn)?.[p],
    objects: () =>
      [...game.world.entities.all()]
        .filter((e) => e.sprite)
        .map((e) => ({
          id: e.id,
          owner: e.owner,
          type: e.type,
          x: e.x,
          y: e.y,
          state: e.state,
          heldType: e.heldType,
          heldAmount: e.heldAmount,
          graphic: e.sprite!.graphic,
          frame: e.sprite!.frame,
        })),
    issueWork: (units, target, x, y) => game.issue({ type: 'work', units, target, x, y }),
    objectScreenPos: (id) => layer()?.objectCentre(id) ?? null,
  };
  return panel;
}
