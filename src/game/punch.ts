/**
 * What counts as a straight punch.
 *
 * Modelled on how Roblox melee systems handle this, because the problems are
 * the same and they were solved there years ago:
 *
 * - **Multi-point swept hitbox.** RaycastHitbox-style: several points across
 *   the striking surface, each tested along the path it swept since last
 *   frame. One point at the palm centre misses punches whose knuckles were
 *   dead on target, and testing only where a point *ended up* lets a fast fist
 *   pass clean through a head between frames.
 * - **Startup, active, recovery.** A swing arms a hitbox for a short active
 *   window rather than being a single instant test. At 30fps an instant test
 *   throws away most of a real punch.
 * - **Hitstun and block stun.** Landing one buys you time; throwing into a
 *   guard costs you some.
 *
 * Pure — no three.js, no DOM.
 */

import type { Vec3 } from '../hands/project.js';

/**
 * Minimum hand speed to arm a swing, metres per second, judged against the
 * peak of the motion rather than its average.
 *
 * Measured on a smoothed hand position, which always reads lower than the real
 * one — filtering a spike is what filters do.
 */
export const MIN_PUNCH_SPEED = 0.9;

/**
 * How closely the punch has to travel along the line to the target: the cosine
 * of the angle between them. About 52 degrees of slop — tight enough that a
 * sideways swipe misses, loose enough that a punch at a moving head counts.
 */
export const MIN_ALIGNMENT = 0.62;

/**
 * How long the hitbox stays live once a swing is armed.
 *
 * The active window in fighting-game terms. Contact any time inside it counts,
 * which is what stops a punch being thrown away because the one frame it was
 * tested on happened to fall either side of the target.
 */
export const ACTIVE_MS = 130;

/** How long after a punch that hand can't throw another. */
export const PUNCH_COOLDOWN_MS = 240;

/**
 * Shorter cooldown when the last punch landed.
 *
 * Roblox M1 systems let you chain straight into the next swing if the previous
 * one connected, and make you wait if it didn't. Rewarding contact with tempo
 * is most of what makes trading punches feel like a rhythm.
 */
export const CHAIN_COOLDOWN_MS = 150;

/**
 * Longer cooldown when the last punch was blocked.
 *
 * The block stun idea: throwing into a guard should cost you the initiative.
 */
export const BLOCKED_COOLDOWN_MS = 420;

/**
 * How far past a strike point the hitbox extends, metres.
 *
 * Roughly the width of a fist. Small on purpose — the swept, multi-point test
 * is what provides reliability, so this doesn't have to, and a large radius
 * only makes hits land where you didn't throw them.
 */
export const PUNCH_REACH = 0.09;

export interface Swing {
  /** Current strike points — the knuckles, not the palm centre. */
  points: readonly Vec3[];
  /** Where those points were last frame, for the sweep. Null on the first. */
  previous: readonly Vec3[] | null;
  /** Hand velocity over the recent window, metres per second. */
  velocity: Vec3;
  /** Peak speed over that window. */
  peakSpeed?: number;
}

export interface Punch {
  /** Peak speed of the swing, metres per second. */
  speed: number;
  /** How square the punch was, 0..1. Feeds damage. */
  alignment: number;
  /** Closest approach to the target. */
  distance: number;
  /** Which strike point connected. */
  pointIndex: number;
}

function length(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

export function distanceBetween(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/**
 * How well `velocity` points along the line from `from` to `to`.
 * @returns -1..1, or null when either vector is too small to have a direction.
 */
export function alignmentTo(velocity: Vec3, from: Vec3, to: Vec3): number | null {
  const speed = length(velocity);
  if (speed < 1e-4) return null;

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const distance = Math.hypot(dx, dy, dz);
  if (distance < 1e-4) return null;

  return (velocity.x * dx + velocity.y * dy + velocity.z * dz) / (speed * distance);
}

/** Closest the segment from `a` to `b` comes to `point`. */
export function distanceToSegment(a: Vec3, b: Vec3, point: Vec3): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const lengthSquared = dx * dx + dy * dy + dz * dz;

  if (lengthSquared < 1e-12) return distanceBetween(a, point);

  const t = Math.max(
    0,
    Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy + (point.z - a.z) * dz) / lengthSquared),
  );
  return distanceBetween({ x: a.x + dx * t, y: a.y + dy * t, z: a.z + dz * t }, point);
}

/**
 * Closest approach of any strike point's swept path to `target`.
 * @returns the distance and which point it was, or null with no points.
 */
export function sweptDistance(
  points: readonly Vec3[],
  previous: readonly Vec3[] | null,
  target: Vec3,
): { distance: number; pointIndex: number } | null {
  let best = Infinity;
  let bestIndex = -1;

  for (let i = 0; i < points.length; i += 1) {
    const point = points[i]!;
    const from = previous?.[i];
    const distance = from ? distanceToSegment(from, point, target) : distanceBetween(point, target);
    if (distance < best) {
      best = distance;
      bestIndex = i;
    }
  }

  return bestIndex === -1 ? null : { distance: best, pointIndex: bestIndex };
}

/** What happened to the last punch, which decides how soon you can throw again. */
export type LastOutcome = 'none' | 'landed' | 'blocked';

export class PunchDetector {
  private lastPunchMs = -Infinity;
  private lastOutcome: LastOutcome = 'none';
  /** While in the future, a swing is armed and its hitbox is live. */
  private activeUntil = -Infinity;
  private armedAlignment = 0;
  private armedSpeed = 0;

  constructor(
    private readonly minSpeed: number = MIN_PUNCH_SPEED,
    private readonly minAlignment: number = MIN_ALIGNMENT,
    private readonly cooldownMs: number = PUNCH_COOLDOWN_MS,
  ) {}

  /** Whether a hitbox is currently live. Drives the swing's visual tell. */
  active(nowMs: number): boolean {
    return nowMs < this.activeUntil;
  }

  private cooldownFor(outcome: LastOutcome): number {
    if (outcome === 'landed') return Math.min(this.cooldownMs, CHAIN_COOLDOWN_MS);
    if (outcome === 'blocked') return Math.max(this.cooldownMs, BLOCKED_COOLDOWN_MS);
    return this.cooldownMs;
  }

  ready(nowMs: number): boolean {
    return nowMs - this.lastPunchMs >= this.cooldownFor(this.lastOutcome);
  }

  /**
   * @param target the head being aimed at
   * @param radius how big that head is
   * @returns the punch, or null for a miss
   */
  test(swing: Swing, target: Vec3, radius: number, nowMs: number, reach = PUNCH_REACH): Punch | null {
    if (!this.ready(nowMs)) return null;

    const speed = Math.max(length(swing.velocity), swing.peakSpeed ?? 0);
    const origin = swing.previous?.[0] ?? swing.points[0];
    const alignment = origin ? alignmentTo(swing.velocity, origin, target) : null;

    // Arm the hitbox the moment the hand commits: fast enough, and pointed at
    // them. Alignment is judged from where the swing began, because a punch
    // that carried through past the head aims backwards from where it ended.
    if (speed >= this.minSpeed && alignment !== null && alignment >= this.minAlignment) {
      this.activeUntil = nowMs + ACTIVE_MS;
      this.armedAlignment = alignment;
      this.armedSpeed = Math.max(this.armedSpeed, speed);
    }

    if (!this.active(nowMs)) return null;

    const contact = sweptDistance(swing.points, swing.previous, target);
    if (!contact || contact.distance > radius + reach) return null;

    this.lastPunchMs = nowMs;
    this.activeUntil = -Infinity;

    const punch: Punch = {
      speed: this.armedSpeed,
      alignment: this.armedAlignment,
      distance: contact.distance,
      pointIndex: contact.pointIndex,
    };
    this.armedSpeed = 0;
    return punch;
  }

  /** Tell it what became of the last punch, which sets the next cooldown. */
  resolve(outcome: LastOutcome): void {
    this.lastOutcome = outcome;
  }

  reset(): void {
    this.lastPunchMs = -Infinity;
    this.activeUntil = -Infinity;
    this.lastOutcome = 'none';
    this.armedSpeed = 0;
    this.armedAlignment = 0;
  }
}

/**
 * Damage from a punch: mostly speed, scaled by how square it landed. A glancing
 * blow that barely cleared the alignment threshold should not hit as hard as
 * one straight down the pipe.
 */
export function punchDamage(punch: Punch, base = 11): number {
  const speedFactor = Math.min(2, punch.speed / MIN_PUNCH_SPEED);
  const squareness = (punch.alignment - MIN_ALIGNMENT) / (1 - MIN_ALIGNMENT);
  return Math.round(base * speedFactor * (0.6 + 0.4 * Math.max(0, Math.min(1, squareness))));
}
