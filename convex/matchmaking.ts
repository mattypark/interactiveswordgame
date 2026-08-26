import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

/**
 * Pairing people up.
 *
 * The queue is first-come, first-served within a map. Joining looks for
 * someone already waiting; if there is one, both are pulled out and a match
 * row is created. If not, you wait and someone else will pair with you.
 */

/** Queue entries older than this are assumed abandoned. */
const STALE_QUEUE_MS = 45_000;

const EMPTY_FIGHTER = {
  head: { x: 0, y: 0.32, z: 0 },
  fist: { x: 0, y: 0.28, z: 0.1 },
  health: 100,
  rounds: 0,
  punchSeq: 0,
  punchDamage: 0,
  updatedAt: 0,
};

export const join = mutation({
  args: { playerId: v.string(), name: v.string(), mapId: v.string() },
  handler: async (ctx, { playerId, name, mapId }) => {
    // Rejoining shouldn't leave a stale entry behind.
    const mine = await ctx.db
      .query('queue')
      .withIndex('by_player', (q) => q.eq('playerId', playerId))
      .collect();
    for (const entry of mine) await ctx.db.delete(entry._id);

    const now = Date.now();
    const waiting = await ctx.db
      .query('queue')
      .withIndex('by_map', (q) => q.eq('mapId', mapId))
      .collect();

    for (const entry of waiting) {
      if (now - entry.joinedAt > STALE_QUEUE_MS) {
        await ctx.db.delete(entry._id);
        continue;
      }
      if (entry.playerId === playerId) continue;

      // Someone is waiting: take them out of the queue and start a match.
      await ctx.db.delete(entry._id);
      const matchId = await ctx.db.insert('matches', {
        mapId,
        hostId: entry.playerId,
        guestId: playerId,
        hostName: entry.name,
        guestName: name,
        phase: 'fighting',
        round: 1,
        startedAt: now,
        host: { ...EMPTY_FIGHTER, updatedAt: now },
        guest: { ...EMPTY_FIGHTER, updatedAt: now },
      });
      return { status: 'matched' as const, matchId };
    }

    await ctx.db.insert('queue', { playerId, name, mapId, joinedAt: now });
    return { status: 'waiting' as const, matchId: null };
  },
});

export const leave = mutation({
  args: { playerId: v.string() },
  handler: async (ctx, { playerId }) => {
    const mine = await ctx.db
      .query('queue')
      .withIndex('by_player', (q) => q.eq('playerId', playerId))
      .collect();
    for (const entry of mine) await ctx.db.delete(entry._id);
  },
});

/**
 * Your current match, if any. Polled while waiting: the person who was already
 * in the queue finds out they've been paired by seeing this turn up.
 */
export const myMatch = query({
  args: { playerId: v.string() },
  handler: async (ctx, { playerId }) => {
    const asHost = await ctx.db
      .query('matches')
      .withIndex('by_host', (q) => q.eq('hostId', playerId))
      .order('desc')
      .first();
    if (asHost && asHost.phase !== 'over') return asHost;

    const asGuest = await ctx.db
      .query('matches')
      .withIndex('by_guest', (q) => q.eq('guestId', playerId))
      .order('desc')
      .first();
    if (asGuest && asGuest.phase !== 'over') return asGuest;

    return null;
  },
});

export const waitingCount = query({
  args: { mapId: v.string() },
  handler: async (ctx, { mapId }) => {
    const now = Date.now();
    const waiting = await ctx.db
      .query('queue')
      .withIndex('by_map', (q) => q.eq('mapId', mapId))
      .collect();
    return waiting.filter((entry) => now - entry.joinedAt <= STALE_QUEUE_MS).length;
  },
});
