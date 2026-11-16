/**
 * The game's log for the client (victory.md §16): the notifications the sim raises (`RGE_Base_Game::notification`, the
 * tribute and diplomacy messages, a defeat, a resignation) and each player's history (`TRIBE_History_Info`,
 * src/t_histry.cpp): its population every 15 game seconds and the ages it reached, which the timeline draws.
 */

export const NOTIFY_PLAYER_RESIGNED = 5;
export const NOTIFY_PLAYER_DEFEATED = 6;
export const NOTIFY_TRIBUTE_PAID = 7;
export const NOTIFY_DIPLOMACY_CHANGED = 8;

/** Seconds between two history entries (`TRIBE_Player::update`, src/tplayer.cpp:355-363). */
export const HISTORY_INTERVAL = 15;

/** History events (`add_history_event`, src/tech.cpp:272-278): the age techs 101, 102, 103. */
export const HISTORY_TOOL_AGE = 0;
export const HISTORY_BRONZE_AGE = 1;
export const HISTORY_IRON_AGE = 2;
const AGE_EVENTS: Readonly<Record<number, number>> = { 101: HISTORY_TOOL_AGE, 102: HISTORY_BRONZE_AGE, 103: HISTORY_IRON_AGE };

/** One `notification(type, p1, p2, p3, p4)` call, at the world time of the step that raised it. */
export interface Notification {
  /** `world_time` in ms. */
  worldTime: number;
  type: number;
  args: [number, number, number, number];
}

/** `TRIBE_History_Events`: an age reached, after `time` population entries. */
export interface HistoryEvent {
  /** `number_of_entries` when the event was added. */
  time: number;
  worldTime: number;
  event: number;
}

/** `TRIBE_History_Info` with the player's `update_history_count`. */
export interface PlayerHistory {
  /** Game seconds since the last entry (`update_history_count`). */
  count: number;
  /** One population byte per entry (`(unsigned char)(long)` of attribute 11; a negative population reads 0). */
  population: number[];
  /** Newest last (the original links them newest first). */
  events: HistoryEvent[];
}

export interface GameLog {
  notifications: Notification[];
  /** Per player; Gaia's stays empty (`TRIBE_Gaia::update` keeps no history). */
  history: PlayerHistory[];
}

export function newGameLog(players: number): GameLog {
  return { notifications: [], history: Array.from({ length: players }, () => ({ count: 0, population: [], events: [] })) };
}

export function copyGameLog(log: GameLog): GameLog {
  return {
    notifications: log.notifications.map((n) => ({ ...n, args: [...n.args] })),
    history: log.history.map((h) => ({ count: h.count, population: [...h.population], events: h.events.map((e) => ({ ...e })) })),
  };
}

export function notify(log: GameLog, worldTime: number, type: number, p1 = 0, p2 = 0, p3 = 0, p4 = 0): void {
  log.notifications.push({ worldTime, type, args: [p1, p2, p3, p4] });
}

/** `add_population_entry` / the 15 s entry: `(unsigned char)(long)population`, 0 when it is negative. */
export function addPopulationEntry(log: GameLog, player: number, population: number): void {
  log.history[player]!.population.push(population < 0 ? 0 : Math.trunc(population) & 0xff);
}

/** The once-a-second part of `TRIBE_Player::update` (src/tplayer.cpp:355-363): every 15th second adds an entry. */
export function historySecond(log: GameLog, player: number, population: number): void {
  const h = log.history[player]!;
  if (++h.count >= HISTORY_INTERVAL) {
    h.count -= HISTORY_INTERVAL;
    addPopulationEntry(log, player, population);
  }
}

/** `TRIBE_Player_Tech::do_tech` (src/tech.cpp:272-278): an age tech adds an event once the history has an entry. */
export function historyTech(log: GameLog, player: number, tech: number, worldTime: number): void {
  const event = AGE_EVENTS[tech];
  const h = log.history[player];
  if (event === undefined || !h || h.population.length === 0) return;
  h.events.push({ time: h.population.length, worldTime, event });
}
