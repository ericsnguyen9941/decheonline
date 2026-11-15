import type { AssetProvider } from '../assets';
import { frameCursor } from './frame-image';
import { SLP } from './layout';

/**
 * Frames of mcursors.slp (`TMousePointer::set_game_facet`): the original's arrow, the hand shown over a work target, and
 * the ring over what a priest heals or converts.
 */
const ARROW = 0;
const HAND = 3;
const RING = 5;

/**
 * Sets the original's mouse cursors on `host` as CSS variables: `--cursor-normal` (the arrow, which the original also
 * shows over its own units: `get_mouse_pointer_action_vars` asks for no other facet there) and `--cursor-work` (the hand
 * over an object the selection can work on) and `--cursor-target` (the ring over a priest's heal or convert target). Without
 * art nothing is set and the browser's cursors stay.
 */
export async function applyCursors(host: HTMLElement, provider: AssetProvider): Promise<void> {
  const arrow = provider.interfaceFrame(SLP.cursors, ARROW);
  const hand = provider.interfaceFrame(SLP.cursors, HAND);
  const ring = provider.interfaceFrame(SLP.cursors, RING);
  if (!arrow || !hand || !ring) return;
  const [normal, work, target] = await Promise.all([frameCursor(arrow, 'default'), frameCursor(hand, 'pointer'), frameCursor(ring, 'crosshair')]);
  host.style.setProperty('--cursor-normal', normal);
  host.style.setProperty('--cursor-work', work);
  host.style.setProperty('--cursor-target', target);
}

export function clearCursors(host: HTMLElement): void {
  host.style.removeProperty('--cursor-normal');
  host.style.removeProperty('--cursor-work');
  host.style.removeProperty('--cursor-target');
}
