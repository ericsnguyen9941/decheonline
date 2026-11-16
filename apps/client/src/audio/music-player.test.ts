import { beforeEach, expect, test } from 'vitest';
import type { MusicTable } from '../assets';
import { MusicPlayer } from './music-player';
import type { SoundPlayer } from './sound-player';

// Nine tracks and the named files, as the 1.0a install has them. Without an audio context nothing is synthesized, but
// the player still walks its list (`playing`).
const table: MusicTable = {
  tracks: 9,
  url: (name) => `/assets/music/${name}`,
  bankUrl: '/assets/music/bank.dls',
};
const audio = { onStart: () => undefined } as unknown as SoundPlayer;

function player(): MusicPlayer {
  const m = new MusicPlayer(audio);
  m.setTable(table);
  return m;
}
const end = (m: MusicPlayer) => m['ended']();

// The client's tests run in Node: a Map stands in for the page's localStorage.
beforeEach(() => {
  const store = new Map<string, string>();
  globalThis.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) } as unknown as Storage;
});

test('a game plays music1 to music9 in order, then from music1 again', () => {
  const m = player();
  m.playTracks(1, m.tracks, true);
  const heard = [m.playing];
  for (let i = 0; i < 10; i++) {
    end(m);
    heard.push(m.playing);
  }
  expect(heard).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 1, 2].map((n) => `music${n}.mid`));
});

test('a named file plays once unless looped; play_tracks clamps to the tracks there are', () => {
  const m = player();
  m.playFile('won.mid', false);
  expect(m.playing).toBe('won.mid');
  end(m);
  expect(m.playing).toBeNull();
  m.playTracks(12, 20, false);
  expect(m.playing).toBe('music9.mid');
  end(m);
  expect(m.playing).toBeNull();
});

test('the volume starts at the middle stop and is kept; OK at "Off" shuts the music down, from off starts every track', () => {
  const m = player();
  expect(m.volume).toBe(50);
  m.playTracks(1, 9, true);
  m.volume = 99;
  m.applyVolume();
  expect(m.on).toBe(false);
  expect(m.playing).toBeNull();
  m.playFile('lost.mid', false);
  expect(m.playing).toBeNull();
  // Saved at the bottom: the next game's music starts off (`setup_music_system`).
  expect(player().on).toBe(false);
  m.volume = 30;
  m.applyVolume();
  expect(m.on).toBe(true);
  expect(m.playing).toBe('music1.mid');
  expect(player().volume).toBe(30);
});
