/**
 * "Today" for a player, as SQL.
 *
 * Every daily limit in the game - the chest, quests, each kind of ad, the
 * treasure allowance - resets at the PLAYER'S local midnight, worked out from
 * the server's own clock and the time zone stored on their account. The
 * phone's clock is never consulted, so winding a phone's date forward earns
 * nothing: the server simply does not believe it.
 *
 * These used to be a rolling 24 hours, which testers read as "the daily
 * rewards don't reset": an ad watched at 9pm stayed counted until 9pm the next
 * day, long after the calendar - and the chest - had moved on.
 *
 * `tz` is an SQL EXPRESSION that yields the zone name (a column such as
 * `u.time_zone`, or a sub-select). It is spliced into the query text, so it
 * must only ever come from code in this repository, never from a request.
 */

/** The instant the player's current local day began. */
export function localMidnightSql(tz: string): string {
  return `(date_trunc('day', NOW() AT TIME ZONE ${tz}) AT TIME ZONE ${tz})`;
}

/** The instant the player's next local day begins - when "Back tomorrow" ends. */
export function nextLocalMidnightSql(tz: string): string {
  return `((date_trunc('day', NOW() AT TIME ZONE ${tz}) + INTERVAL '1 day') AT TIME ZONE ${tz})`;
}

/** The time zone of the user whose id is parameter $1. */
export const USER_TZ = '(SELECT time_zone FROM users WHERE id = $1)';
