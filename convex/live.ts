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
 * That trusts each client to score its own punches — the same split Roblox
 * combat systems use, where the client casts for responsiveness and the server
 * owns the damage. Server-side hit resolution would need both players' full
 * hand skeletons at 60Hz, which is far more traffic and latency than the
 * cheating it prevents is worth.
 *
 * What the server does do is refuse anything impossible: a punch harder than
 * one can be, punches faster than a hand can throw them, and more than one
 * punch reported per update. None of that needs the skeletons, and it turns
 * "trusts the client" into "trusts the client within limits".
 */

/** Hardest a single punch can be, matching punchDamage's own ceiling. */
const MAX_PUNCH_DAMAGE = 22;

/** Fastest a hand can legitimately throw them, from CHAIN_COOLDOWN_MS. */
const MIN_PUNCH_INTERVAL_MS = 140;

/** Punches one update may report. More than one means a client is inventing them. */
const MAX_PUNCHES_PER_PUSH = 1;

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

    const now = Date.now();

    // Damage from punches the other side hasn't been told about yet, clamped
    // to what the game can actually produce.
    const claimed = Math.max(0, args.punchSeq - mine.punchSeq);
    const landed = Math.min(claimed, MAX_PUNCHES_PER_PUSH);
    const tooSoon = now - mine.updatedAt < MIN_PUNCH_INTERVAL_MS;
    const damage = Math.min(Math.max(0, args.punchDamage), MAX_PUNCH_DAMAGE);

    const applied = landed > 0 && !tooSoon ? damage : 0;
    const theirHealth = Math.max(0, theirs.health - applied);

    await ctx.db.patch(args.matchId, {
      [side]: {
        ...mine,
        head: args.head,
        fist: args.fist,
        // Store the sequence the server accepted, not the one claimed, so a
        // client can't run its counter up and cash it in later.
        punchSeq: mine.punchSeq + landed,
        punchDamage: applied,
        updatedAt: now,
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
