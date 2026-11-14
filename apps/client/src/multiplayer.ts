import type { Application } from 'pixi.js';
import { ATTR_HEADROOM, ATTR_POPULATION, ATTR_POPULATION_LIMIT, type World } from '@aoe/sim';
import { createAssetProvider } from './assets';
import { Lockstep, showEndDialog } from './lockstep';
import { FrameClock } from './lockstep/frame-clock';
import { LobbyView, Session } from './lobby';
import { exposeMapDebug, MapView } from './map';
import { tileCoordsToPixel } from './map/iso';
import { constructionProgress, trainingStatus } from './hud/commands';
import { GameHud } from './hud/game-hud';
import { resourcesOf, type Resources } from './hud/resource-bar';
import { connect } from './net/link';
import { isBuildingObject, isUnit, UnitLayer, type Ghost } from './units/unit-layer';

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
  /** Population of `player` (default: this client's): units (attribute 11), the room houses give (4) and the limit (32). */
  population(player?: number): DebugPopulation;
  /** Every building and foundation, in id order, with its construction progress and production queue. */
  buildings(): DebugBuilding[];
  /** Production queue of building `id`; null when there is no such building. */
  queue(id: number): DebugQueue | null;
  /** The building being placed and where its ghost stands; null when not placing. */
  ghost(): Ghost | null;
  /** Step size and buffer frames the sim runs at now, this client's mean frame time and the server's round trips. */
  net(): DebugNet;
  /** Hold every pong this long, faking a slow link to the server. */
  delayPongs(ms: number): void;
}

export interface DebugNet {
  granularity: number;
  frames: number;
  frameMs: number;
  /** Round trip from the server to each slot, ms. */
  rtt: number[];
}

export interface DebugPopulation {
  count: number;
  headroom: number;
  limit: number;
}

export interface DebugQueue {
  /** Records in training order: unit type and how many are paid for. */
  records: { unit: number; count: number }[];
  /** The unit in training and its whole percent (0 before it starts); null with an empty queue. */
  training: { unit: number; progress: number } | null;
}

export interface DebugBuilding {
  id: number;
  owner: number;
  type: number;
  x: number;
  y: number;
  /** `object_state`: 0 foundation, 2 active. */
  state: number;
  hp: number;
  /** Whole percent built. */
  progress: number;
  /** Dat graphic of the sprite shown (the construction sprite while unbuilt) and the building's facet. */
  graphic: number;
  facet: number;
  queue: DebugQueue;
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

  // Mean frame time the server tunes the step size to (docs/spec/turn-timing.md §3.2).
  const frames = new FrameClock();
  app.ticker.add((ticker) => frames.sample(ticker.elapsedMS));

  session.onStart = (start, you) => {
    const player = you + 1;
    const game = new Lockstep({
      link,
      speed,
      start: { seed: start.seed, commandDelay: start.commandDelay, playerCount: start.players.length },
      frameMs: () => frames.average(),
    });
    lockstep = game;
    setGameVisible(true);
    game.onDesync = (turn) => end('desync', `The two games disagreed at turn ${turn}. The game cannot continue.`);
    game.onEnded = () => end('peer-left', 'Your opponent left the game.');
    if (debug) panel = debugPanel(host, game, player, () => units, frames);
    void createAssetProvider().then(async (provider) => {
      const view = await MapView.create(app, game.world.map, provider);
      if (lockstep !== game) return view.destroy();
      mapView = view;
      const layer = new UnitLayer({
        app,
        view,
        world: game.world,
        provider,
        player,
        issue: (c) => game.issue(c),
        turnMs: (t) => game.turnMs(t),
        onPlacement: (unit) => hud?.commands.placementChanged(unit),
        onRollover: (text) => hud?.rollover(text),
      });
      units = layer;
      hud = new GameHud({
        parent: app.canvas.parentElement!,
        app,
        world: game.world,
        provider,
        player,
        selection: layer,
        issue: (c) => game.issue(c),
        startPlacement: (unit) => layer.startPlacement(unit),
        cancelPlacement: () => layer.cancelPlacement(),
      });
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

function debugPanel(host: HTMLElement, game: Lockstep, player: number, layer: () => UnitLayer | undefined, frames: FrameClock): HTMLElement {
  const panel = document.createElement('div');
  panel.dataset.testid = 'net-debug';
  const status = document.createElement('span');
  status.dataset.testid = 'net-status';
  const speed = document.createElement('span');
  speed.dataset.testid = 'net-speed';
  const net = (): DebugNet => ({ granularity: game.world.granularity, frames: game.world.frames, frameMs: frames.average(), rtt: game.rtt });
  const button = document.createElement('button');
  button.dataset.testid = 'send-test';
  button.textContent = 'Send test command';
  let n = 0;
  const issue = (x: number, y: number) => game.issue({ type: 'test', x, y });
  button.addEventListener('click', () => issue(10 + n++, 20));
  const stock = new Map<number, Resources[]>();
  game.onTurn = (turn, hash) => {
    status.textContent = `turn ${turn} hash ${hash}`;
    const n = net();
    speed.textContent = `G ${n.granularity} ms F ${n.frames} frame ${n.frameMs} ms RTT ${n.rtt.length > 0 ? n.rtt.join(' + ') : '?'} ms`;
    stock.set(turn, Array.from({ length: game.world.players }, (_, p) => resourcesOf(game.world, p)));
  };
  panel.append(status, speed, button);
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
    population: (p = player) => {
      const a = game.world.attributes[p]!;
      return { count: a[ATTR_POPULATION]!, headroom: a[ATTR_HEADROOM]!, limit: a[ATTR_POPULATION_LIMIT]! };
    },
    buildings: () =>
      [...game.world.entities.all()].filter(isBuildingObject).map((e) => ({
        id: e.id,
        owner: e.owner,
        type: e.type,
        x: e.x,
        y: e.y,
        state: e.state,
        hp: e.hp,
        progress: constructionProgress(e),
        graphic: e.sprite?.graphic ?? -1,
        facet: e.facet ?? 0,
        queue: queueOf(game.world, e.id)!,
      })),
    queue: (id) => queueOf(game.world, id),
    ghost: () => layer()?.ghost ?? null,
    net,
    delayPongs: (ms) => (game.pongDelayMs = ms),
  };
  return panel;
}

function queueOf(world: World, id: number): DebugQueue | null {
  const e = world.entities.get(id);
  if (!e || !isBuildingObject(e)) return null;
  return { records: (e.queue ?? []).map((r) => ({ unit: r.unit, count: r.count })), training: trainingStatus(e) };
}
