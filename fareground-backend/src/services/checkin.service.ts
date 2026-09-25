/**
 * Visits: mark where you have been.
 *
 * (The database tables and the /checkin route keep their original names; the
 * player-facing word is "visit".)
 *
 *   POST /checkin  { lat, lng, accuracyM, placeName? }
 *
 * A place you have never checked in at before (a new ~250 m square) pays a
 * bonus, which rewards going somewhere new rather than walking the same loop.
 * The reward is written as a reward_claims row, so "watch an ad to double
 * it" works exactly as it does for the daily chest and quests.
 *
 * Only a coarse ~250 m square and the place NAME are stored, never the exact
 * position: a history of exactly where someone stood each day is not
 * something to keep.
 */
import type { QueryResult, QueryResultRow } from 'pg';
import { withTransaction } from '../db/pool';
import {
  CHECKIN_EXTRA_NEEDS_AD,
  MAX_TARGET_DRIFT_M,
  CHECKIN_MAX_ACCURACY_M,
  CHECKIN_NEW_PLACE_BONUS_WP,
  CHECKIN_WP,
  PLACE_SCALE,
} from '../game/rules';
import { metresBetween } from './parcels.service';
import { HttpError } from '../utils/httpError';
import { applyShare, guardAction, payoutShare } from './integrity.service';
import { spendExtraCheckinAd } from './rewards.service';
import type { ClaimSummary } from './daily.service';

export interface CheckinStatus {
  /** True when today's FREE visit has not been used yet. */
  available: boolean;
  /** The most recent visit today, if any. */
  today: { placeName: string | null; newPlace: boolean; claim: ClaimSummary } | null;
  /** How many places you have visited today. */
  countToday: number;
  /** After the free one, every visit costs a rewarded ad. */
  extraNeedsAd: boolean;
  /** Consecutive days with a visit, ending today or yesterday. */
  streak: number;
  placesVisited: number;
  baseWp: number;
  newPlaceBonusWp: number;
}

/** Anything that can run a query: the pool helper or a transaction's client. */
type Db = { query<T extends QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<T>> };

/**
 * A place, as a square on a fixed lat/lng lattice.
 *
 * The scale is carried alongside because it has changed once already: rows
 * written before migration 016 describe ~1 km squares, and comparing them
 * against today's ~250 m squares would silently call somewhere familiar new.
 */
export const placeSquare = (lat: number, lng: number, scale: number = PLACE_SCALE) => ({
  x: Math.round(lat * scale),
  y: Math.round(lng * scale),
  scale,
});

export async function checkinStatus(client: Db, userId: string, today: string): Promise<CheckinStatus> {
  const r = await client.query<{
    place_name: string | null; new_place: boolean; claim_id: string | null; amount: number | null;
    doubled_at: Date | null; can_double: boolean | null; places: number; streak: number; count_today: number;
  }>(
    // The streak is a "gaps and islands" count over the DISTINCT days that
    // have a check-in (there can be several a day now): days that run
    // consecutively share `local_day - dense_rank`.
    `WITH days AS (
       SELECT DISTINCT local_day FROM checkins
        WHERE user_id = $1 AND local_day > $2::date - 400
     ),
     grouped AS (
       SELECT local_day, local_day - (DENSE_RANK() OVER (ORDER BY local_day))::int AS grp FROM days
     ),
     runs AS (SELECT grp, MAX(local_day) AS last, COUNT(*)::int AS len FROM grouped GROUP BY grp),
     latest AS (
       SELECT * FROM checkins WHERE user_id = $1 AND local_day = $2::date
        ORDER BY created_at DESC LIMIT 1
     )
     SELECT c.place_name, c.new_place, c.claim_id, rc.amount, rc.doubled_at,
            (rc.doubled_at IS NULL AND rc.created_at > NOW() - INTERVAL '24 hours') AS can_double,
            (SELECT COUNT(DISTINCT (place_scale, place_x, place_y))::int FROM checkins WHERE user_id = $1) AS places,
            COALESCE((SELECT len FROM runs WHERE last >= $2::date - 1 ORDER BY last DESC LIMIT 1), 0) AS streak,
            (SELECT COUNT(*) FROM checkins WHERE user_id = $1 AND local_day = $2::date)::int AS count_today
       FROM (SELECT 1) one
       LEFT JOIN latest c ON TRUE
       LEFT JOIN reward_claims rc ON rc.id = c.claim_id`,
    [userId, today],
  );
  const row = r.rows[0];
  const checkedToday = row.count_today > 0;
  return {
    available: !checkedToday,
    countToday: row.count_today,
    extraNeedsAd: checkedToday,
    today:
      checkedToday && row.claim_id && row.amount
        ? {
            placeName: row.place_name,
            newPlace: row.new_place,
            claim: { id: row.claim_id, amount: row.amount, doubled: row.doubled_at !== null, canDouble: !!row.can_double },
          }
        : null,
    streak: row.streak,
    placesVisited: row.places,
    baseWp: CHECKIN_WP,
    newPlaceBonusWp: CHECKIN_NEW_PLACE_BONUS_WP,
  };
}

/**
 * ---------------------------------------------------------------------------
 *  TODAY'S AREA - one place to walk to, rolled for you
 * ---------------------------------------------------------------------------
 *  A visit used to be "press the button wherever you are", which rewarded
 *  standing still. Then it was a 5x5 board of nearby squares, which was
 *  better but still a MENU: everything around you, pick one. A menu is not a
 *  reason to leave the house.
 *
 *  Now the server rolls ONE nearby square and says: go there. Walk to it,
 *  check in, watch an ad to double the reward, watch another to be given the
 *  next one. That is a loop with a destination in it.
 *
 *  THREE THINGS THAT MAKE IT WORK, and each is easy to get wrong:
 *
 *  1. THE TARGET IS WRITTEN DOWN, NOT RECOMPUTED. If it were rolled from the
 *     player's current position each time they opened the app it would run
 *     away from them as they walked towards it. It is rolled once, stored in
 *     `area_targets`, and read back until claimed.
 *
 *  2. ONE OPEN TARGET AT A TIME, enforced by a partial unique index, not by
 *     hoping. Two phones cannot each roll one and leave a player with a
 *     backlog of destinations - which would be the menu again.
 *
 *  3. IT MUST BE FAR ENOUGH TO BE A WALK AND NEAR ENOUGH TO BE TODAY'S. The
 *     square you are standing in is never chosen, and neither is anywhere
 *     past the ring - see TARGET_MIN_RING.
 *
 *  The gate on claiming is unchanged and still lives on the server: your own
 *  coordinates must fall inside the square. You cannot check in to today's
 *  area from the sofa.
 */

/**
 * How far out the roll reaches, in squares.
 *
 * MIN 1 so the target is never the square you are already standing in -
 * "walk to where you are" is not a destination. MAX 3 keeps it inside about
 * 750 m, which is a ten-minute walk rather than an expedition; the point is
 * something you can do today, not a quest.
 */
const TARGET_MIN_RING = 1;
const TARGET_MAX_RING = 3;

export interface AreaTarget {
  /** Stable key for the square, "x:y". */
  key: string;
  x: number;
  y: number;
  /** Centre of the square, so the app can point at it and draw it. */
  lat: number;
  lng: number;
  /** Metres from where the player is NOW to the centre. */
  distanceM: number;
  /** True when they are standing in it - the only time a check-in is accepted. */
  here: boolean;
  /** Roughly how wide the square is, so the app can say "within ~170 m". */
  areaSizeM: number;
  /** They have been in this square before, so no explorer bonus. */
  visited: boolean;
  /** What claiming it would pay. */
  wp: number;
  /** True when this one was bought with an ad rather than being the daily free one. */
  fromAd: boolean;
}

export interface AreasStatus {
  /** Where to go. Null only when we have no position to roll from. */
  target: AreaTarget | null;
  /** Areas claimed today. */
  claimedToday: number;
  /**
   * True when there is no open target and the next one costs an ad - i.e.
   * today's free area has already been claimed.
   */
  nextNeedsAd: boolean;
  extraNeedsAd: boolean;
}

/** Centre of the square a rounded (x, y) names. */
const squareCentre = (x: number, y: number, scale: number) => ({
  lat: x / scale,
  lng: y / scale,
});

/** Roughly how wide a square is on the ground, at this latitude. */
const areaWidthM = (lat: number, scale: number) =>
  Math.round((111_320 / scale) * Math.cos((lat * Math.PI) / 180));

type TargetRow = {
  id: string;
  place_x: number;
  place_y: number;
  place_scale: number;
  from_ad: boolean;
  local_day: string;
};

/**
 * Is this target still somewhere the player could actually go?
 *
 * Two ways it stops being one, and they compound: the day rolled over
 * without them claiming it, or they have physically moved away from it.
 * Either way they should get a fresh one rather than be stuck.
 */
function abandonReason(
  row: TargetRow,
  today: string,
  lat: number,
  lng: number,
): 'STALE_DAY' | 'TOO_FAR' | null {
  if (row.local_day < today) return 'STALE_DAY';
  const centre = squareCentre(row.place_x, row.place_y, row.place_scale);
  if (metresBetween(lat, lng, centre.lat, centre.lng) > MAX_TARGET_DRIFT_M) return 'TOO_FAR';
  return null;
}

/**
 * Pick a square to send someone to.
 *
 * Uniform over the ring band, with the centre square excluded. Deliberately
 * NOT weighted towards unvisited squares: in a place someone walks every day
 * everything is visited, and a roll that then had nothing to offer would
 * quietly stop working exactly for the most engaged players.
 */
function rollTarget(lat: number, lng: number, scale: number) {
  const here = placeSquare(lat, lng, scale);
  for (let attempt = 0; attempt < 40; attempt++) {
    const dx = Math.floor(Math.random() * (TARGET_MAX_RING * 2 + 1)) - TARGET_MAX_RING;
    const dy = Math.floor(Math.random() * (TARGET_MAX_RING * 2 + 1)) - TARGET_MAX_RING;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < TARGET_MIN_RING) continue;
    return { x: here.x + dx, y: here.y + dy, scale };
  }
  // Every draw landed in the centre square, which needs 40 consecutive
  // 1-in-49 results. Step one square east rather than return nothing.
  return { x: here.x + TARGET_MIN_RING, y: here.y, scale };
}

/** Shape one stored row into what the app needs, measured from where they are now. */
async function describeTarget(
  client: Db,
  userId: string,
  row: TargetRow,
  lat: number,
  lng: number,
): Promise<AreaTarget> {
  const centre = squareCentre(row.place_x, row.place_y, row.place_scale);
  const seen = await client.query(
    'SELECT 1 FROM checkins WHERE user_id = $1 AND place_scale = $4 AND place_x = $2 AND place_y = $3 LIMIT 1',
    [userId, row.place_x, row.place_y, row.place_scale],
  );
  const visited = (seen.rowCount ?? 0) > 0;
  const standingIn = placeSquare(lat, lng, row.place_scale);
  return {
    key: `${row.place_x}:${row.place_y}`,
    x: row.place_x,
    y: row.place_y,
    lat: centre.lat,
    lng: centre.lng,
    distanceM: Math.round(metresBetween(lat, lng, centre.lat, centre.lng)),
    here: standingIn.x === row.place_x && standingIn.y === row.place_y,
    areaSizeM: areaWidthM(lat, row.place_scale),
    visited,
    wp: CHECKIN_WP + (visited ? 0 : CHECKIN_NEW_PLACE_BONUS_WP),
    fromAd: row.from_ad,
  };
}

/**
 * What the app shows: the open target, or nothing to go to yet.
 *
 * Rolls today's FREE target if there is no open one and none has been
 * claimed today. Every target after that costs an ad and is minted by
 * `rollNextArea`, not here - otherwise opening the screen would hand out
 * destinations for free.
 */
export async function areasStatus(
  client: Db,
  userId: string,
  lat: number,
  lng: number,
  today: string,
): Promise<AreasStatus> {
  const claimedToday = await client.query<{ n: number }>(
    'SELECT COUNT(*)::int AS n FROM area_targets WHERE user_id = $1 AND local_day = $2::date AND claimed_at IS NOT NULL',
    [userId, today],
  );
  const done = claimedToday.rows[0].n;

  const open = await client.query<TargetRow>(
    `SELECT id, place_x, place_y, place_scale, from_ad, to_char(local_day, 'YYYY-MM-DD') AS local_day
       FROM area_targets
      WHERE user_id = $1 AND claimed_at IS NULL AND abandoned_at IS NULL`,
    [userId],
  );

  let row: TargetRow | null = open.rows[0] ?? null;

  // A target from a past day, or one the player has moved away from, is
  // abandoned so a fresh one can be rolled. Recorded rather than deleted:
  // if this fires constantly the roll radius is wrong, and the data says so.
  if (row) {
    const reason = abandonReason(row, today, lat, lng);
    if (reason) {
      await client.query(
        'UPDATE area_targets SET abandoned_at = NOW(), abandoned_reason = $2 WHERE id = $1',
        [row.id, reason],
      );
      row = null;
    }
  }

  // The one free roll a day. `ON CONFLICT DO NOTHING` on the partial unique
  // index means two phones asking at once produce ONE target, not two.
  if (!row && done === 0) {
    const pick = rollTarget(lat, lng, PLACE_SCALE);
    const inserted = await client.query<TargetRow>(
      `INSERT INTO area_targets (user_id, local_day, place_x, place_y, place_scale, origin_lat, origin_lng, from_ad)
       VALUES ($1, $2::date, $3, $4, $5, $6, $7, FALSE)
       ON CONFLICT DO NOTHING
       RETURNING id, place_x, place_y, place_scale, from_ad, to_char(local_day, 'YYYY-MM-DD') AS local_day`,
      [userId, today, pick.x, pick.y, pick.scale, lat, lng],
    );
    if (inserted.rowCount) {
      row = inserted.rows[0];
    } else {
      const again = await client.query<TargetRow>(
        `SELECT id, place_x, place_y, place_scale, from_ad, to_char(local_day, 'YYYY-MM-DD') AS local_day
           FROM area_targets
          WHERE user_id = $1 AND claimed_at IS NULL AND abandoned_at IS NULL`,
        [userId],
      );
      row = again.rows[0] ?? null;
    }
  }

  return {
    target: row ? await describeTarget(client, userId, row, lat, lng) : null,
    claimedToday: done,
    nextNeedsAd: !row && done > 0,
    extraNeedsAd: CHECKIN_EXTRA_NEEDS_AD,
  };
}

/**
 * Buy the next destination with a rewarded ad.
 *
 * The ad is spent only once the target exists, so a refusal (one is already
 * open) leaves the ticket intact.
 */
export async function rollNextArea(
  userId: string,
  lat: number,
  lng: number,
  adNonce: string,
): Promise<AreasStatus> {
  return withTransaction(async (client) => {
    const u = await client.query<{ today: string }>(
      `SELECT to_char((NOW() AT TIME ZONE time_zone)::date, 'YYYY-MM-DD') AS today
         FROM users WHERE id = $1 FOR UPDATE`,
      [userId],
    );
    if (u.rowCount === 0) throw new HttpError(401, 'User no longer exists.');
    const today = u.rows[0].today;

    const open = await client.query(
      'SELECT 1 FROM area_targets WHERE user_id = $1 AND claimed_at IS NULL AND abandoned_at IS NULL',
      [userId],
    );
    if ((open.rowCount ?? 0) > 0) {
      throw new HttpError(409, 'You already have somewhere to go. Get there first.');
    }

    const pick = rollTarget(lat, lng, PLACE_SCALE);
    await client.query(
      `INSERT INTO area_targets (user_id, local_day, place_x, place_y, place_scale, origin_lat, origin_lng, from_ad)
       VALUES ($1, $2::date, $3, $4, $5, $6, $7, TRUE)`,
      [userId, today, pick.x, pick.y, pick.scale, lat, lng],
    );

    await spendExtraCheckinAd(client, userId, adNonce);
    return areasStatus(client, userId, lat, lng, today);
  });
}

export interface CheckinResult {
  claim: ClaimSummary;
  newPlace: boolean;
  placeName: string | null;
  walkPointsBalance: number;
}

export async function checkIn(
  userId: string,
  input: {
    lat: number;
    lng: number;
    accuracyM: number;
    placeName?: string;
    mocked?: boolean;
  },
): Promise<CheckinResult> {
  if (input.accuracyM > CHECKIN_MAX_ACCURACY_M) {
    throw new HttpError(422, `Your location is only accurate to ${Math.round(input.accuracyM)} m. Step outside and try again.`);
  }
  const placeName = input.placeName?.replace(/\s+/g, ' ').trim().slice(0, 160) || null;
  const sq = placeSquare(input.lat, input.lng);

  return withTransaction(async (client) => {
    const u = await client.query<{ today: string }>(
      `SELECT to_char((NOW() AT TIME ZONE time_zone)::date, 'YYYY-MM-DD') AS today FROM users WHERE id = $1 FOR UPDATE`,
      [userId],
    );
    if (u.rowCount === 0) throw new HttpError(401, 'User no longer exists.');
    const today = u.rows[0].today;

    // THERE HAS TO BE SOMEWHERE TO GO, AND YOU HAVE TO BE IN IT.
    //
    // A check-in is no longer "wherever I am" - it claims the target that was
    // rolled for you. The target row is locked so the same one cannot be
    // claimed twice by two phones, and the square is compared against YOUR
    // OWN coordinates, not against anything the app sent. That is the whole
    // gate: without it, today's area is claimable from the sofa.
    const target = await client.query<{
      id: string; place_x: number; place_y: number; place_scale: number;
    }>(
      `SELECT id, place_x, place_y, place_scale
         FROM area_targets
        WHERE user_id = $1 AND claimed_at IS NULL AND abandoned_at IS NULL
        FOR UPDATE`,
      [userId],
    );
    if (target.rowCount === 0) {
      throw new HttpError(409, 'You have nowhere to go right now. Watch an ad for a new area.');
    }
    const t = target.rows[0];

    // Layer 3, inside the same transaction as the reward.
    await guardAction(client, userId, 'CHECKIN', input);

    const standingIn = placeSquare(input.lat, input.lng, t.place_scale);
    if (standingIn.x !== t.place_x || standingIn.y !== t.place_y) {
      throw new HttpError(422, 'You are not in that area yet. Keep walking.');
    }

    const seen = await client.query(
      'SELECT 1 FROM checkins WHERE user_id = $1 AND place_scale = $4 AND place_x = $2 AND place_y = $3 LIMIT 1',
      [userId, t.place_x, t.place_y, t.place_scale],
    );
    const newPlace = (seen.rowCount ?? 0) === 0;
    const amount = applyShare(
      CHECKIN_WP + (newPlace ? CHECKIN_NEW_PLACE_BONUS_WP : 0),
      await payoutShare({ query: client.query.bind(client) as never }, userId),
    );

    const claim = await client.query<{ id: string }>(
      `INSERT INTO reward_claims (user_id, source, quest_key, local_day, amount)
       VALUES ($1, 'CHECKIN', $2, $3::date, $4) RETURNING id`,
      [userId, `${t.place_x}:${t.place_y}`.slice(0, 32), today, amount],
    );
    await client.query(
      `INSERT INTO checkins (user_id, local_day, place_x, place_y, place_scale, place_name, accuracy_m, new_place, claim_id, from_ad)
       VALUES ($1, $2::date, $3, $4, $10, $5, $6, $7, $8, $9)`,
      [userId, today, t.place_x, t.place_y, placeName, input.accuracyM, newPlace, claim.rows[0].id, false, t.place_scale],
    );

    // Close the target. The partial unique index only permits one OPEN row,
    // so this is what frees the player to be given another.
    await client.query(
      'UPDATE area_targets SET claimed_at = NOW(), claim_id = $2 WHERE id = $1',
      [t.id, claim.rows[0].id],
    );
    const bal = await client.query<{ walk_points_balance: number }>(
      'UPDATE users SET walk_points_balance = walk_points_balance + $2 WHERE id = $1 RETURNING walk_points_balance',
      [userId, amount],
    );

    return {
      claim: { id: claim.rows[0].id, amount, doubled: false, canDouble: true },
      newPlace,
      placeName,
      walkPointsBalance: bal.rows[0].walk_points_balance,
    };
  });
}
