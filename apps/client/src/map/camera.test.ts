import { expect, test } from 'vitest';
import { Camera } from './camera';
import { tileAtPixel } from './iso';

const W = 48;
const H = 40;

test('moveTo reports whether the camera moved and rounds to whole pixels', () => {
  const cam = new Camera(W, H, 800, 450);
  cam.centerOn(1500, 700);
  expect(cam.moveTo(cam.x, cam.y)).toBe(false);
  expect(cam.moveTo(cam.x + 10.4, cam.y)).toBe(true);
  expect(Number.isInteger(cam.x)).toBe(true);
});

test('the view centre never leaves the map, however far the camera is pushed', () => {
  const cam = new Camera(W, H, 800, 450);
  for (const [x, y] of [[-9999, -9999], [99999, 0], [0, 99999], [99999, 99999], [1500, -500]] as const) {
    cam.moveTo(x, y);
    expect(tileAtPixel(cam.point.x, cam.point.y, W, H)).not.toBeNull();
  }
});

test('the view centre point sits 32 px left of and 16 px above the middle of the viewport, as RGE_View::update puts it', () => {
  const cam = new Camera(W, H, 800, 450);
  cam.centerOn(1500, 700);
  expect(cam.point).toEqual({ x: 1500, y: 700 });
  expect([cam.x, cam.y]).toEqual([1500 - 400 + 32, 700 - 225 + 16]);
  cam.resize(1000, 600);
  expect(cam.point).toEqual({ x: 1500, y: 700 });
});
