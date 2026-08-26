import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

/**
 * Live versus.
 *
 * Two tables. `queue` is people waiting; `matches` holds a paired fight and
 * both players' live state. Player state lives on the match row rather than in
 * its own table so one subscription delivers everything a client needs — an
 * extra round trip per frame is exactly what a fighting game can't afford.
 */

const fighterState = v.object({
  /** Head position in play-volume space. */
  head: v.object({ x: v.number(), y: v.number(), z: v.number() }),
  /** Lead fist position, so the other side can see the punch coming. */
  fist: v.object({ x: v.number(), y: v.number(), z: v.number() }),
  health: v.number(),
  rounds: v.number(),
  /** Bumped on every landed punch, so the other client can react exactly once. */
  punchSeq: v.number(),
  /** Damage carried by the most recent punch. */
  punchDamage: v.number(),
  /** Client clock at the last write, for staleness checks. */
  updatedAt: v.number(),
});

export default defineSchema({
  queue: defineTable({
    playerId: v.string(),
    name: v.string(),
    mapId: v.string(),
    joinedAt: v.number(),
  })
    .index('by_map', ['mapId'])
    .index('by_player', ['playerId']),

  matches: defineTable({
    mapId: v.string(),
    hostId: v.string(),
    guestId: v.string(),
    hostName: v.string(),
    guestName: v.string(),
    phase: v.union(
      v.literal('waiting'),
      v.literal('fighting'),
      v.literal('knockdown'),
      v.literal('over'),
    ),
    round: v.number(),
    startedAt: v.number(),
    host: fighterState,
    guest: fighterState,
  })
    .index('by_host', ['hostId'])
    .index('by_guest', ['guestId']),
});
