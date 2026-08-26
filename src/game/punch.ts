/**
 * What counts as a straight punch.
 *
 * A fast hand near someone's head isn't a punch — a hook that happens to pass
 * through, or a hand being waved about, would both land. A straight punch is
 * fast *and* travelling along the line to the target. Requiring that alignment
 * is what makes the game about aim rather than about flailing.
 *
 * Pure — no three.js, no DOM.
 */

import type { Vec3 } from '../hands/project.js';

/** Minimum hand speed to count. Metres per second. */
export const MIN_PUNCH_SPEED = 1.35;

/**
 * How closely the punch has to travel along the line to the target: the cosine
 * of the angle between them. 0.72 is about 44 degrees of slop — tight enough
 * that a sideways swipe misses, loose enough that a real punch lands.
 */
export const MIN_ALIGNMENT = 0.72;

/** How long after a punch that hand can't throw another. */
export const PUNCH_COOLDOWN_MS = 420;

/** Reach, metres. Beyond this you're punching air. */
export const PUNCH_REACH = 0.34;

export interface Punch {
  /** Speed at the moment of contact, metres per second. */
  speed: number;
  /** How square the punch was, 0..1. Feeds damage. */
  alignment: number;
  /** Distance to the target when it landed. */
  distance: number;
}

function length(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
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

export function distanceBetween(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export class PunchDetector {
  private lastPunchMs = -Infinity;

  constructor(
    private readonly minSpeed: number = MIN_PUNCH_SPEED,
    private readonly minAlignment: number = MIN_ALIGNMENT,
    private readonly cooldownMs: number = PUNCH_COOLDOWN_MS,
  ) {}

  /**
   * @param hand where the fist is
   * @param velocity how fast it's travelling, metres per second
   * @param target the head being aimed at
   * @param radius how big that head is
   * @returns the punch, or null for a miss
   */
  test(
    hand: Vec3,
    velocity: Vec3,
    target: Vec3,
    radius: number,
    nowMs: number,
    reach: number = PUNCH_REACH,
  ): Punch | null {
    if (nowMs - this.lastPunchMs < this.cooldownMs) return null;

    const distance = distanceBetween(hand, target);
    // Contact means the fist is inside the head, or close enough that the arm
    // it's attached to would have connected.
    if (distance > radius + reach) return null;

    const speed = length(velocity);
    if (speed < this.minSpeed) return null;

    const alignment = alignmentTo(velocity, hand, target);
    if (alignment === null || alignment < this.minAlignment) return null;

    this.lastPunchMs = nowMs;
    return { speed, alignment, distance };
  }

  /** Ready to throw again. */
  ready(nowMs: number): boolean {
    return nowMs - this.lastPunchMs >= this.cooldownMs;
  }

  reset(): void {
    this.lastPunchMs = -Infinity;
  }
}

/**
 * Damage from a punch: mostly speed, scaled by how square it landed. A glancing
 * blow that barely cleared the alignment threshold should not hit as hard as
 * one straight down the pipe.
 */
export function punchDamage(punch: Punch, base = 9): number {
  const speedFactor = Math.min(2, punch.speed / MIN_PUNCH_SPEED);
  const squareness = (punch.alignment - MIN_ALIGNMENT) / (1 - MIN_ALIGNMENT);
  return Math.round(base * speedFactor * (0.6 + 0.4 * Math.max(0, Math.min(1, squareness))));
}
