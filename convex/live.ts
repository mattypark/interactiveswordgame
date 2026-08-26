import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';

/**
 * The live channel during a match.
 *
 * Each client writes only its own half of the row and reads the whole thing.
 * Punches are reported by the client that threw them and carried on a counter
 * rather than as an event, so a dropped or duplicated update can't cost or
 * repeat a hit — the receiver applies the difference between the sequence it
 * has seen and the one it's given.
 *
 * That trusts each client to score its own punches. For a game you play with
 * friends that's the right trade: server-side hit resolution would need both
 * players' full skeletons at 60Hz, which is far more traffic and latency than
 * the cheating it prevents is worth.
 */

const vec = v.object({ x: v.number(), y: v.number(), z: v.number() });

export const state = query({
  args: { matchId: v.id('matches') },
  handler: async (ctx, { matchId }) => ctx.db.get(matchId),
});

export const push = mutation({
  args: {
    matchId: v.id('matches'),
    playerId: v.string(),
    head: vec,
    fist: vec,
    /** Total damage this player has dealt so far, and how many punches. */
    punchSeq: v.number(),
    punchDamage: v.number(),
  },
  handler: async (ctx, args) => {
    const match = await ctx.db.get(args.matchId);
    if (!match) return null;

    const side = sideOf(match, args.playerId);
    if (!side) return null;

    const mine = match[side];
    const theirSide = side === 'host' ? 'guest' : 'host';
    const theirs = match[theirSide];

    // Damage from punches the other side hasn't been told about yet.
    const landed = Math.max(0, args.punchSeq - mine.punchSeq);
    const theirHealth = landed > 0 ? Math.max(0, theirs.health - args.punchDamage) : theirs.health;

    await ctx.db.patch(args.matchId, {
      [side]: {
        ...mine,
        head: args.head,
        fist: args.fist,
        punchSeq: args.punchSeq,
        punchDamage: args.punchDamage,
        updatedAt: Date.now(),
      },
      [theirSide]: { ...theirs, health: theirHealth },
    } as never);

    return null;
  },
});

/** Called by whichever client notices the round ended. Idempotent by round. */
export const endRound = mutation({
  args: { matchId: v.id('matches'), winner: v.union(v.literal('host'), v.literal('guest')), round: v.number() },
  handler: async (ctx, { matchId, winner, round }) => {
    const match = await ctx.db.get(matchId);
    // Both clients will call this; only the first one for a given round counts.
    if (!match || match.round !== round || match.phase !== 'fighting') return null;

    const rounds = match[winner].rounds + 1;
    const over = rounds >= 2;

    await ctx.db.patch(matchId, {
      phase: over ? 'over' : 'fighting',
      round: over ? round : round + 1,
      host: {
        ...match.host,
        health: 100,
        rounds: winner === 'host' ? rounds : match.host.rounds,
      },
      guest: {
        ...match.guest,
        health: 100,
        rounds: winner === 'guest' ? rounds : match.guest.rounds,
      },
    });
    return null;
  },
});

export const forfeit = mutation({
  args: { matchId: v.id('matches') },
  handler: async (ctx, { matchId }) => {
    const match = await ctx.db.get(matchId);
    if (!match) return null;
    await ctx.db.patch(matchId, { phase: 'over' });
    return null;
  },
});

function sideOf(match: Doc<'matches'>, playerId: string): 'host' | 'guest' | null {
  if (match.hostId === playerId) return 'host';
  if (match.guestId === playerId) return 'guest';
  return null;
}

export type MatchId = Id<'matches'>;
