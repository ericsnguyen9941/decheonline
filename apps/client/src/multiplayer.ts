import { Lockstep, showEndDialog } from './lockstep';
import { LobbyView, Session } from './lobby';
import { connect } from './net/link';

/** What `?debug=net` exposes as `window.__game`, for tests and manual poking. */
export interface NetDebug {
  /** Queue a `test` command from this client. */
  issueTest(x: number, y: number): void;
  /** Next turn to execute (== turns executed so far). */
  turn(): number;
  hash(turn: number): number | undefined;
  /** Commands applied so far, from each slot. */
  applied(): { type: string }[][];
  /** Entities in the sim, by owner. */
  entityOwners(): number[];
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
}

/** Connects to the relay, shows the lobby in `host`, and runs lockstep once the game starts. */
export async function startMultiplayer(host: HTMLElement, { debug, speed }: MultiplayerOptions): Promise<void> {
  const link = await connect();
  const session = new Session(link);
  const view = new LobbyView(session);
  host.append(view.root);

  let lockstep: Lockstep | undefined;
  let panel: HTMLElement | undefined;

  const end = (kind: 'desync' | 'peer-left', detail: string) => {
    lockstep?.stop();
    lockstep = undefined;
    panel?.remove();
    window.__game = undefined;
    session.finish();
    showEndDialog(kind, detail, () => undefined);
  };

  session.onStart = (start) => {
    const game = new Lockstep({
      link,
      speed,
      start: { seed: start.seed, turnMs: start.turnMs, commandDelay: start.commandDelay, playerCount: start.players.length },
    });
    lockstep = game;
    game.onDesync = (turn) => end('desync', `The two games disagreed at turn ${turn}. The game cannot continue.`);
    game.onEnded = () => end('peer-left', 'Your opponent left the game.');
    if (debug) panel = debugPanel(host, game);
  };
}

function debugPanel(host: HTMLElement, game: Lockstep): HTMLElement {
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
  game.onTurn = (turn, hash) => (status.textContent = `turn ${turn} hash ${hash}`);
  panel.append(status, button);
  host.append(panel);
  window.__game = {
    issueTest: issue,
    turn: () => game.turn,
    hash: (turn) => game.hashes.get(turn),
    applied: () => game.applied,
    entityOwners: () => [...game.world.entities.all()].map((e) => e.owner),
  };
  return panel;
}
