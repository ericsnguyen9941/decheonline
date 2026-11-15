import { describe, expect, test } from 'vitest';
import { ACTION_ARTIFACT, ARTIFACT_CHECK, ARTIFACT_WAIT, artifactResetOwner, checkOwnership, startArtifact } from './artifact';
import type { Command } from './commands';
import { typeOf } from './masters';
import { RELIC, RUIN } from './rmm-objects';
import { TOWN_CENTER, TREES, VILLAGER } from './units';
import { VICTORY_SPECIAL } from './victory';
import { COMMAND_DELAY_TURNS, World, type StartUnit } from './world';

/** Gaia and two players with these objects (ids from 1 in list order); conquest off. */
function world(...units: StartUnit[]): World {
  return new World({ players: 3, units, victory: { type: VICTORY_SPECIAL } });
}

/** Issue `command` for `player` and run the turns until it has run. */
function order(w: World, player: number, command: Command): void {
  w.addBatch(w.turn, player, [command]);
  for (let i = 0; i <= COMMAND_DELAY_TURNS; i++) w.runTurn();
}

function runUntil(w: World, done: () => boolean, limit = 200): void {
  for (let i = 0; i < limit && !done(); i++) w.runTurn();
  expect(done()).toBe(true);
}

/** A relic (id 1) next to a player 1 Villager (id 2), taken by player 1; player 2's Villager (id 3) far away. */
function ownRelic(...more: StartUnit[]): World {
  const w = world({ owner: 0, type: RELIC, x: 30.5, y: 12.5 }, { owner: 1, type: VILLAGER, x: 32.5, y: 12.5 }, { owner: 2, type: VILLAGER, x: 60.5, y: 5.5 }, ...more);
  runUntil(w, () => w.entities.get(1)!.owner === 1, 20);
  return w;
}

describe('a player\'s orders to an own relic (victory.md §10.2): move_to and work2, no action 107', () => {
  test('the dat: task 0 of the relic and the ruin is action 107 with no unit, group or terrain, and no default task', () => {
    const w = world();
    for (const id of [RELIC, RUIN]) {
      const t = w.masters[1]![id]!;
      expect(t.action!.tasks[0]).toMatchObject({ actionType: ACTION_ARTIFACT, unitId: -1, group: -1, combatLevel: 0 });
      expect(t.action!.tasks.every((k) => k.isDefault === 0)).toBe(true);
    }
    expect([w.masters[1]![RELIC]!.speed, w.masters[1]![RUIN]!.speed]).toEqual([1, 0]);
  });

  test('a move order walks the relic at its speed 1 to the point (RGE_Action_Object::move_to, src/act_obj.cpp:111-138)', () => {
    const w = ownRelic();
    const relic = w.entities.get(1)!;
    order(w, 1, { type: 'move', units: [1], x: 30.5, y: 20.5 });
    expect(relic.work).toBeNull();
    expect(relic.mover!.action).not.toBeNull();
    w.runTurn();
    const [y0, t0] = [relic.y, w.worldTime];
    for (let i = 0; i < 4; i++) w.runTurn();
    const speed = (relic.y - y0) / ((w.worldTime - t0) / 1000);
    expect(speed).toBeGreaterThan(0.9);
    expect(speed).toBeLessThanOrEqual(1.0001);
    // `move_to`'s range 0.4 from the edge (radius 0.35).
    runUntil(w, () => Math.abs(relic.y - 20.5) < 0.8 && relic.mover!.action === null);
    expect([relic.owner, relic.work]).toEqual([1, null]);
  });

  test('another player\'s move order on the relic is ignored', () => {
    const w = ownRelic();
    const relic = w.entities.get(1)!;
    order(w, 2, { type: 'move', units: [1], x: 30.5, y: 20.5 });
    for (let i = 0; i < 20; i++) w.runTurn();
    expect([relic.x, relic.y, relic.mover!.action]).toEqual([30.5, 12.5, null]);
  });

  test('a work order on a tree, an own Town Center or an enemy Villager finds no task (get_target_task): the relic walks there', () => {
    const tree = TREES[0];
    const w = ownRelic({ owner: 0, type: tree, x: 30.5, y: 18.5 }, { owner: 1, type: TOWN_CENTER, x: 22.5, y: 12.5 });
    const relic = w.entities.get(1)!;
    for (const [target, x, y] of [[4, 30.5, 18.5], [5, 22.5, 12.5], [3, 60.5, 5.5]] as const) {
      order(w, 1, { type: 'work', units: [1], target, x, y });
      expect(relic.work).toBeNull();
      expect(relic.mover!.action).not.toBeNull();
    }
  });
});

describe('TRIBE_Action_Artifact (action 107, src/tact_art.cpp), started directly', () => {
  test('to a point: walks there while checking its tiles every 3 s (set_state 4 → 6 → 10)', () => {
    const w = ownRelic();
    const relic = w.entities.get(1)!;
    startArtifact(w.gameContext(), relic, 0, undefined, 30.5, 16.5);
    expect(relic.work).toMatchObject({ type: ACTION_ARTIFACT, state: ARTIFACT_CHECK, target: -1, x: 30.5, y: 16.5 });
    expect(relic.mover!.action).not.toBeNull();
    w.runStep();
    expect(relic.work).toMatchObject({ state: ARTIFACT_WAIT, timer: 3 });
    runUntil(w, () => Math.abs(relic.y - 16.5) < 0.8 && relic.mover!.action === null);
    // The action stays, waiting and checking again, after the walk.
    expect(relic.work?.type).toBe(ACTION_ARTIFACT);
    expect([ARTIFACT_CHECK, ARTIFACT_WAIT]).toContain(relic.work!.state);
  });

  test('to an object: walks to where it is now and forgets it (set_state 5)', () => {
    const w = ownRelic({ owner: 1, type: TOWN_CENTER, x: 22.5, y: 12.5 });
    const relic = w.entities.get(1)!;
    startArtifact(w.gameContext(), relic, 0, w.entities.get(4), -1, -1);
    expect(relic.work).toMatchObject({ state: ARTIFACT_CHECK, target: -1, x: 22.5, y: 12.5 });
  });

  test('check_ownership: one other player\'s active units on the tiles from x - 1.35 to x + 1.35; Gaia, the owner alone, or two players do not count', () => {
    const w = ownRelic({ owner: 0, type: TREES[0], x: 31.5, y: 13.5 });
    const ctx = w.gameContext();
    const relic = w.entities.get(1)!;
    const p1 = w.entities.get(2)!;
    const p2 = w.entities.get(3)!;
    const at = (e: typeof p1, x: number, y: number) => {
      e.x = x;
      e.y = y;
    };
    expect(checkOwnership(ctx, relic)).toBe(-1);
    at(p1, 60.5, 20.5);
    at(p2, 31.9, 12.5);
    expect(checkOwnership(ctx, relic)).toBe(2);
    at(p2, 32.1, 12.5);
    expect(checkOwnership(ctx, relic)).toBe(-1);
    at(p2, 29.0, 11.0);
    expect(checkOwnership(ctx, relic)).toBe(2);
    at(p1, 30.9, 13.9);
    expect(checkOwnership(ctx, relic)).toBe(-1);
    at(p2, 60.5, 5.5);
    expect(checkOwnership(ctx, relic)).toBe(-1);
  });

  test('the check takes the relic for the single other player on its tiles, where the unit AI (two players in view) would not', () => {
    const w = ownRelic();
    const relic = w.entities.get(1)!;
    // Player 1's Villager 2 tiles off stays in the relic's LOS 2 (the unit AI freezes) but outside the scan.
    const p2 = w.entities.get(3)!;
    order(w, 2, { type: 'move', units: [3], x: 30.5, y: 11.5 });
    for (let i = 0; i < 200 && Math.abs(p2.x - 30.5) + Math.abs(p2.y - 11.5) > 0.6; i++) w.runTurn();
    for (let i = 0; i < 20; i++) w.runTurn();
    expect(relic.owner).toBe(1);
    startArtifact(w.gameContext(), relic, 0, undefined, -1, -1);
    expect(relic.work!.state).toBe(ARTIFACT_CHECK);
    w.runStep();
    expect([relic.owner, relic.work]).toEqual([2, null]);
    expect(relic.sprite!.graphic).toBe(typeOf(w, relic).standing.graphic);
  });

  test('reset_owner (state 100; nothing calls it): the next update gives the relic to Gaia, which ends the action', () => {
    const w = ownRelic();
    const relic = w.entities.get(1)!;
    startArtifact(w.gameContext(), relic, 0, undefined, -1, -1);
    w.runStep();
    artifactResetOwner(w.gameContext(), relic, relic.work!);
    w.runStep();
    expect([relic.owner, relic.work]).toEqual([0, null]);
  });
});
