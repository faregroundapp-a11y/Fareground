/**
 * Trading coins for Walk Points.
 *
 *   POST /store/walk-points { walkPoints }
 *
 * TerraMine's real secret, copied on purpose (see COINS_PER_WALK_POINT in
 * rules.ts): land compounds and it is the fun part, so players reinvest their
 * earnings into more of it - and every coin traded is a coin never cashed out.
 *
 * Income is settled first, so a player can spend what their land earned up to
 * this second. The whole trade is one transaction under the user's row lock:
 * the balance check and the debit cannot be split by a second request.
 */
import type { PoolClient } from 'pg';
import { withTransaction } from '../db/pool';
import { COINS_PER_WALK_POINT, MAX_WALK_POINTS_PER_TRADE } from '../game/rules';
import { HttpError } from '../utils/httpError';
import { settleCoinIncome } from './user.service';

export interface TradeResult {
  walkPoints: number;
  coinsSpent: number;
  walkPointsBalance: number;
  coins: number;
}

export async function tradeCoinsForWalkPoints(userId: string, walkPoints: number): Promise<TradeResult> {
  const wp = Math.floor(walkPoints);
  if (wp < 1 || wp > MAX_WALK_POINTS_PER_TRADE) {
    throw new HttpError(400, `Trade between 1 and ${MAX_WALK_POINTS_PER_TRADE} Walk Points at a time.`);
  }
  const cost = wp * COINS_PER_WALK_POINT;

  return withTransaction(async (client: PoolClient) => {
    // Locks the user row and pays income up to now.
    await settleCoinIncome(client, userId);

    // One conditional UPDATE: it only matches when the balance covers the
    // cost, so a race between two trades cannot overspend.
    const r = await client.query<{ coin_balance: number; walk_points_balance: number }>(
      `UPDATE users
          SET coin_balance = coin_balance - $2,
              walk_points_balance = walk_points_balance + $3
        WHERE id = $1 AND coin_balance >= $2
        RETURNING coin_balance, walk_points_balance`,
      [userId, cost, wp],
    );
    if (r.rowCount === 0) {
      throw new HttpError(409, `That needs ${cost.toLocaleString('en-US')} coins - keep your land earning a little longer.`);
    }
    const row = r.rows[0];

    await client.query(
      `INSERT INTO coin_ledger (user_id, entry_type, amount, balance_after, note)
       VALUES ($1, 'SPEND', $2, $3, $4)`,
      [userId, -cost, row.coin_balance, `Traded for ${wp} Walk Points`],
    );

    return { walkPoints: wp, coinsSpent: cost, walkPointsBalance: row.walk_points_balance, coins: row.coin_balance };
  });
}
