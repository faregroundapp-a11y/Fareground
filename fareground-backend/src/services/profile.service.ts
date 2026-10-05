/**
 * Player profiles and badges.
 *
 *   GET   /profile               your own profile, with progress on every badge
 *   GET   /profile/:username     someone else's (public: no email, no location)
 *   PATCH /profile               { jerseyColor }
 *   POST  /profile/badges/seen   clear the "new badge" dot
 */
import { query, withTransaction } from '../db/pool';
import { badgeStates, levelFor, type BadgeState, type PlayerStats } from '../game/badges';
import {
  AVATAR_ITEMS,
  AVATAR_SLOTS,
  USERNAME_CHANGE_DAYS,
  itemsForSlot,
  jerseyColorOf,
  rarityOf,
  sanitizeAvatar,
  type AvatarSlot,
  unlockedItems,
} from '../game/avatar';
import { photoUrl } from './photo.service';
import { weekStart } from '../game/rules';
import { HttpError } from '../utils/httpError';

export interface AvatarItemState {
  key: string;
  slot: AvatarSlot;
  name: string;
  unlock: string;
  level?: number;
  badge?: string;
  color?: string;
  unlocked: boolean;
  /** True for a locked item a rewarded ad can unlock right now. */
  buyable: boolean;
  /** Why it is locked, in words. */
  requirement: string | null;
}

export interface Profile {
  username: string;
  joinedAt: Date;
  jerseyColor: string;
  /** The character that is this player's picture. */
  avatar: Record<AvatarSlot, string>;
  /** Uploaded picture, or null to fall back to the initial. */
  photoUrl: string | null;
  /** A badge they show off next to their name. */
  title: string | null;
  /** Own profile only: every avatar part, and whether they have it. */
  avatarItems?: AvatarItemState[];
  /** Own profile only: when the username may change again. */
  usernameChangeableAt?: Date | null;
  level: { level: number; current: number; next: number };
  stats: PlayerStats & { thisWeekSteps: number };
  badges: (BadgeState & { unlockedAt: Date | null; isNew: boolean })[];
  badgeCount: { unlocked: number; total: number };
  isYou: boolean;
}

async function statsFor(userId: string): Promise<PlayerStats & { thisWeekSteps: number }> {
  const r = await query<{
    lifetime: number; week: number; parcels: number; amethysts: number; sapphires: number; rubies: number;
    kinds: number; chest: number; places: number; checkin_streak: number; podiums: number; wins: number; ads: number;
  }>(
    `SELECT
       COALESCE((SELECT SUM(raw_steps) FROM step_logs WHERE user_id = $1), 0)::bigint AS lifetime,
       COALESCE((SELECT SUM(raw_steps) FROM step_logs WHERE user_id = $1 AND logged_at >= $2), 0)::bigint AS week,
       (SELECT COUNT(*) FROM parcels WHERE owner_id = $1)::int AS parcels,
       (SELECT COUNT(*) FROM parcels WHERE owner_id = $1 AND rarity = 'AMETHYST')::int AS amethysts,
       (SELECT COUNT(*) FROM parcels WHERE owner_id = $1 AND rarity = 'SAPPHIRE')::int AS sapphires,
       (SELECT COUNT(*) FROM parcels WHERE owner_id = $1 AND rarity = 'RUBY')::int AS rubies,
       (SELECT COUNT(DISTINCT rarity) FROM parcels WHERE owner_id = $1
           AND rarity IN ('ROCKY','COAL','AMETHYST','SAPPHIRE','RUBY'))::int AS kinds,
       COALESCE((SELECT MAX(streak) FROM reward_claims WHERE user_id = $1 AND source = 'DAILY'), 0)::int AS chest,
       (SELECT COUNT(DISTINCT (place_x, place_y)) FROM checkins WHERE user_id = $1)::int AS places,
       COALESCE((
         SELECT MAX(len) FROM (
           SELECT COUNT(*)::int AS len FROM (
             SELECT local_day - (ROW_NUMBER() OVER (ORDER BY local_day))::int AS grp FROM checkins WHERE user_id = $1
           ) d GROUP BY grp
         ) runs
       ), 0)::int AS checkin_streak,
       (SELECT COUNT(*) FROM leaderboard_awards WHERE user_id = $1)::int AS podiums,
       (SELECT COUNT(*) FROM leaderboard_awards WHERE user_id = $1 AND rank = 1)::int AS wins,
       (SELECT COUNT(*) FROM ad_rewards WHERE user_id = $1 AND status = 'GRANTED')::int AS ads`,
    [userId, weekStart(new Date())],
  );
  const s = r.rows[0];
  return {
    lifetimeSteps: s.lifetime,
    thisWeekSteps: s.week,
    parcels: s.parcels,
    amethysts: s.amethysts,
    sapphires: s.sapphires,
    rubies: s.rubies,
    mineralKinds: s.kinds,
    bestChestStreak: s.chest,
    bestCheckinStreak: s.checkin_streak,
    placesVisited: s.places,
    podiums: s.podiums,
    wins: s.wins,
    adsWatched: s.ads,
  };
}

/**
 * Work out badges from stats, record any newly unlocked ones, and return
 * them with their unlock dates. Returns the stats too, to save a query.
 */
async function syncBadges(userId: string) {
  const stats = await statsFor(userId);
  const states = badgeStates(stats);
  const unlocked = states.filter((b) => b.unlocked).map((b) => b.key);
  if (unlocked.length > 0) {
    await query(
      `INSERT INTO user_badges (user_id, badge_key)
       SELECT $1, k FROM unnest($2::text[]) AS k
       ON CONFLICT (user_id, badge_key) DO NOTHING`,
      [userId, unlocked],
    );
  }
  const rows = await query<{ badge_key: string; unlocked_at: Date; seen: boolean }>(
    'SELECT badge_key, unlocked_at, seen FROM user_badges WHERE user_id = $1',
    [userId],
  );
  const byKey = new Map(rows.rows.map((r) => [r.badge_key, r]));
  return { stats, states, byKey };
}

/** How many badges the player has unlocked but not looked at yet. */
export async function unseenBadgeCount(userId: string): Promise<number> {
  const { states, byKey } = await syncBadges(userId);
  return states.filter((b) => b.unlocked && byKey.get(b.key)?.seen === false).length;
}

async function ownedCosmetics(userId: string): Promise<Set<string>> {
  const r = await query<{ item_key: string }>('SELECT item_key FROM user_cosmetics WHERE user_id = $1', [userId]);
  return new Set(r.rows.map((x) => x.item_key));
}

function requirementText(item: (typeof AVATAR_ITEMS)[number]): string | null {
  if (item.unlock === 'FREE') return null;
  if (item.unlock === 'LEVEL') return `Level ${item.level}`;
  if (item.unlock === 'BADGE') return 'Earn its badge';
  return 'Watch an ad';
}

async function buildProfile(userId: string, isYou: boolean): Promise<Profile> {
  const u = await query<{
    username: string; created_at: Date; avatar: Record<string, string> | null; photo_path: string | null;
    title: string | null; username_changed_at: Date | null;
  }>(
    'SELECT username, created_at, avatar, photo_path, title, username_changed_at FROM users WHERE id = $1',
    [userId],
  );
  if (u.rowCount === 0) throw new HttpError(404, 'No such player.');
  const row = u.rows[0];
  const { stats, states, byKey } = await syncBadges(userId);
  const bought = await ownedCosmetics(userId);

  const level = levelFor(stats.lifetimeSteps);
  const earned = new Set(states.filter((b) => b.unlocked).map((b) => b.key));
  const unlocked = unlockedItems({ level: level.level, badges: earned, bought });
  const avatar = sanitizeAvatar(row.avatar as Partial<Record<AvatarSlot, string>>, unlocked);

  // Other players see what someone HAS, not how close they are to the rest.
  const badges = states.map((b) => {
    const seen = byKey.get(b.key);
    return {
      ...b,
      progress: isYou || b.unlocked ? b.progress : 0,
      unlockedAt: seen?.unlocked_at ?? null,
      isNew: isYou && b.unlocked && seen?.seen === false,
    };
  });

  const title = row.title && earned.has(row.title) ? row.title : null;

  const profile: Profile = {
    username: row.username,
    joinedAt: row.created_at,
    jerseyColor: jerseyColorOf(avatar),
    photoUrl: photoUrl(row.photo_path),
    avatar,
    title,
    level,
    stats,
    badges,
    badgeCount: { unlocked: badges.filter((b) => b.unlocked).length, total: badges.length },
    isYou,
  };

  if (isYou) {
    // Sorted commonest-first within each slot so the editor reads as a
    // ladder rather than a scatter, and carrying the rarity so a legendary
    // part can look like one.
    profile.avatarItems = AVATAR_SLOTS.flatMap((slot) =>
      itemsForSlot(slot).map((item) => ({
        key: item.key,
        slot: item.slot,
        name: item.name,
        unlock: item.unlock,
        level: item.level,
        badge: item.badge,
        color: item.color,
        accent: item.accent,
        rarity: rarityOf(item),
        unlocked: unlocked.has(item.key),
        buyable: item.unlock === 'AD' && !unlocked.has(item.key),
        requirement: unlocked.has(item.key) ? null : requirementText(item),
      })),
    );
    profile.usernameChangeableAt = row.username_changed_at
      ? new Date(row.username_changed_at.getTime() + USERNAME_CHANGE_DAYS * 86_400_000)
      : null;
  }
  return profile;
}

export function myProfile(userId: string): Promise<Profile> {
  return buildProfile(userId, true);
}

export async function publicProfile(viewerId: string, username: string): Promise<Profile> {
  const r = await query<{ id: string }>('SELECT id FROM users WHERE lower(username) = lower($1)', [username]);
  if (r.rowCount === 0) throw new HttpError(404, 'No such player.');
  return buildProfile(r.rows[0].id, r.rows[0].id === viewerId);
}

export const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/;

/** PostgreSQL error code 23505 = "unique_violation". */
const isTaken = (e: unknown) =>
  typeof e === 'object' && e !== null && (e as { code?: unknown }).code === '23505';

export async function updateProfile(
  userId: string,
  input: { avatar?: Partial<Record<AvatarSlot, string>>; username?: string; title?: string | null },
): Promise<Profile> {
  // Work out badges and unlocks FIRST, on their own connections.
  //
  // This must not happen inside the transaction below: that transaction locks
  // the user row, and writing a user_badges row needs a shared lock on the
  // same row for its foreign key - so the request would wait for itself,
  // forever. (It did. The API test suite caught it.)
  const { stats, states } = await syncBadges(userId);
  const bought = await ownedCosmetics(userId);
  const earned = new Set(states.filter((b) => b.unlocked).map((b) => b.key));
  const unlocked = unlockedItems({ level: levelFor(stats.lifetimeSteps).level, badges: earned, bought });

  await withTransaction(async (client) => {
    const me = await client.query<{ username: string; username_changed_at: Date | null; avatar: Record<string, string> | null }>(
      'SELECT username, username_changed_at, avatar FROM users WHERE id = $1 FOR UPDATE',
      [userId],
    );
    if (me.rowCount === 0) throw new HttpError(401, 'User no longer exists.');

    // --- name ---
    if (input.username !== undefined) {
      const name = input.username.trim();
      if (!USERNAME_RE.test(name)) {
        throw new HttpError(400, 'Names are 3-32 letters, numbers or underscores.');
      }
      if (name.toLowerCase() !== me.rows[0].username.toLowerCase()) {
        const changed = me.rows[0].username_changed_at;
        if (changed && Date.now() - changed.getTime() < USERNAME_CHANGE_DAYS * 86_400_000) {
          const days = Math.ceil((USERNAME_CHANGE_DAYS * 86_400_000 - (Date.now() - changed.getTime())) / 86_400_000);
          throw new HttpError(409, `You can change your name again in ${days} day${days === 1 ? '' : 's'}.`);
        }
        try {
          await client.query('UPDATE users SET username = $2, username_changed_at = NOW() WHERE id = $1', [userId, name]);
        } catch (e) {
          if (isTaken(e)) throw new HttpError(409, 'That name is taken.');
          throw e;
        }
      }
    }

    // --- title: must be a badge they have earned ---
    if (input.title !== undefined) {
      if (input.title === null) {
        await client.query('UPDATE users SET title = NULL WHERE id = $1', [userId]);
      } else {
        if (!earned.has(input.title)) throw new HttpError(409, 'You have not earned that badge yet.');
        await client.query('UPDATE users SET title = $2 WHERE id = $1', [userId, input.title]);
      }
    }

    // --- avatar: only parts they have unlocked ---
    if (input.avatar !== undefined) {
      // Keep what they are already wearing for any slot the new choice
      // cannot have, rather than dropping it back to the default.
      const current = sanitizeAvatar(me.rows[0].avatar as Partial<Record<AvatarSlot, string>>, unlocked);
      const avatar = sanitizeAvatar({ ...current, ...input.avatar }, unlocked, current);
      await client.query('UPDATE users SET avatar = $2::jsonb, jersey_color = $3 WHERE id = $1', [
        userId,
        JSON.stringify(avatar),
        jerseyColorOf(avatar),
      ]);
    }
  });

  return myProfile(userId);
}

export async function markBadgesSeen(userId: string): Promise<{ ok: true }> {
  await query('UPDATE user_badges SET seen = TRUE WHERE user_id = $1 AND seen = FALSE', [userId]);
  return { ok: true };
}

export { AVATAR_SLOTS };
