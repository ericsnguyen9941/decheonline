import type { AssetProvider } from '../assets';
import { frameCursor } from './frame-image';
import { SLP } from './layout';

/** Frames of mcursors.slp (`TMousePointer::set_game_facet`): the original's arrow, and the hand shown over a work target. */
const ARROW = 0;
const HAND = 3;

/**
 * Sets the original's mouse cursors on `host` as CSS variables: `--cursor-normal` (the arrow, which the original also
 * shows over its own units: `get_mouse_pointer_action_vars` asks for no other facet there) and `--cursor-work` (the hand
 * over an object the selection can work on). Without art nothing is set and the browser's cursors stay.
 */
export async function applyCursors(host: HTMLElement, provider: AssetProvider): Promise<void> {
  const arrow = provider.interfaceFrame(SLP.cursors, ARROW);
  const hand = provider.interfaceFrame(SLP.cursors, HAND);
  if (!arrow || !hand) return;
  const [normal, work] = await Promise.all([frameCursor(arrow, 'default'), frameCursor(hand, 'pointer')]);
  host.style.setProperty('--cursor-normal', normal);
  host.style.setProperty('--cursor-work', work);
}

export function clearCursors(host: HTMLElement): void {
  host.style.removeProperty('--cursor-normal');
  host.style.removeProperty('--cursor-work');
}
