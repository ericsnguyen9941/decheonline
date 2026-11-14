import { Application } from 'pixi.js';
import { GAME_TITLE } from './title';

async function main(): Promise<void> {
  const host = document.getElementById('game');
  if (!host) throw new Error('missing #game element');

  const app = new Application();
  await app.init({ width: 800, height: 450, background: '#2d3b1f' });
  app.canvas.dataset.testid = 'game-canvas';
  host.append(app.canvas);
  document.title = GAME_TITLE;
}

void main();
