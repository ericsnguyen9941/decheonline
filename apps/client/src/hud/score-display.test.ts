import { expect, test } from 'vitest';
import { ICON_HIGH_LATENCY, ICON_LATENCY, ICON_SLOW, netIcons } from './score-display';

const human = () => true;

test('a player shows the latency icon when the round trip between it and this client is above 299 ms', () => {
  // This client is player 1: the latency to player 2 is both legs through the relay, its own stays 30.
  expect(netIcons([1, 2], 1, [20, 40], [16, 16], human)).toEqual(new Map([[1, [0, 0]], [2, [0, 0]]]));
  expect(netIcons([1, 2], 1, [100, 199], [16, 16], human).get(2)).toEqual([0, 0]);
  expect(netIcons([1, 2], 1, [100, 200], [16, 16], human).get(2)).toEqual([ICON_LATENCY, 0]);
  expect(netIcons([1, 2], 1, [500, 500], [16, 16], human).get(2)).toEqual([ICON_LATENCY, 0]);
  expect(netIcons([1, 2], 1, [500, 501], [16, 16], human).get(2)).toEqual([ICON_HIGH_LATENCY, 0]);
  expect(netIcons([2, 1], 1, [9000, 9000], [16, 16], human).get(1)).toEqual([0, 0]);
  // Before the first round trip both are 0: the floor of 30.
  expect(netIcons([1, 2], 2, [], [], human)).toEqual(new Map([[1, [0, 0]], [2, [0, 0]]]));
});

test('the slow icon goes to the first player in line order with the lowest frame rate under 11 fps', () => {
  // 90 ms is 11 fps, 91 ms 10.
  expect(netIcons([1, 2], 1, [], [17, 90], human).get(2)).toEqual([0, 0]);
  expect(netIcons([1, 2], 1, [], [17, 91], human).get(2)).toEqual([0, ICON_SLOW]);
  expect(netIcons([2, 1], 1, [], [120, 120], human)).toEqual(new Map([[2, [0, ICON_SLOW]], [1, [0, 0]]]));
  expect(netIcons([1, 2], 1, [], [1000, 120], human).get(1)).toEqual([0, ICON_SLOW]);
  // A dropped player shows neither icon and is not the slowest.
  expect(netIcons([1, 2], 1, [400, 400], [17, 200], (p) => p !== 2)).toEqual(new Map([[1, [0, 0]]]));
});
