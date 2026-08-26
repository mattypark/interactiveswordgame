import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

/**
 * Who is winning, across everyone.
 *
 * A flat win/loss table rather than a rating system: with a small player base
 * an ELO number moves too slowly to mean anything, and "twelve wins" is
 * legible in a way "1043" is not. Rating can come later if there are ever
 * enough players for it to say something true.
 */

/** Rows returned by the board. */
const TOP_LIMIT = 20;

export const record = mutation({
  args: {
    playerId: v.string(),
    name: v.string(),
    won: v.boolean(),
    /** Best combo landed in the match, for a second thing to chase. */
    bestCombo: v.number(),
  },
  handler: async (ctx, { playerId, name, won, bestCombo }) => {
    const existing = await ctx.db
      .query('scores')
      .withIndex('by_player', (q) => q.eq('playerId', playerId))
      .first();

    const combo = Math.max(0, Math.min(99, Math.floor(bestCombo)));

    if (!existing) {
      await ctx.db.insert('scores', {
        playerId,
        name,
        wins: won ? 1 : 0,
        losses: won ? 0 : 1,
        streak: won ? 1 : 0,
        bestStreak: won ? 1 : 0,
        bestCombo: combo,
        updatedAt: Date.now(),
      });
      return null;
    }

    const streak = won ? existing.streak + 1 : 0;
    await ctx.db.patch(existing._id, {
      // Keep the latest name they played under.
      name,
      wins: existing.wins + (won ? 1 : 0),
      losses: existing.losses + (won ? 0 : 1),
      streak,
      bestStreak: Math.max(existing.bestStreak, streak),
      bestCombo: Math.max(existing.bestCombo, combo),
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const top = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query('scores').withIndex('by_wins').order('desc').take(TOP_LIMIT);
    return rows.map((row) => ({
      name: row.name,
      wins: row.wins,
      losses: row.losses,
      bestStreak: row.bestStreak,
      bestCombo: row.bestCombo,
    }));
  },
});

export const me = query({
  args: { playerId: v.string() },
  handler: async (ctx, { playerId }) => {
    const row = await ctx.db
      .query('scores')
      .withIndex('by_player', (q) => q.eq('playerId', playerId))
      .first();
    if (!row) return null;
    return {
      name: row.name,
      wins: row.wins,
      losses: row.losses,
      streak: row.streak,
      bestStreak: row.bestStreak,
      bestCombo: row.bestCombo,
    };
  },
});
