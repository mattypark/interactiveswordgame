/**
 * Hitting things.
 *
 * A strike is a fast-moving point entering a target's box. Speed is what
 * separates a hit from resting your hand against the dummy, and a cooldown
 * stops one continuous swing registering sixty times a second.
 *
 * Pure — no three.js, no DOM.
 */

import type { Vec3 } from '../hands/project.js';
import type { Aabb } from './grab.js';

/** Below this it's a touch, not a strike. Metres per second. */
export const MIN_STRIKE_SPEED = 0.85;

/** How long after a strike the same target ignores further contact. */
export const STRIKE_COOLDOWN_MS = 260;

export interface Strike {
  /** Speed of the striking point at contact, metres per second. */
  speed: number;
  /** Where it landed, world space. */
  point: Vec3;
  /** Unit direction of travel, for knocking the target back. */
  direction: Vec3;
}

function inside(box: Aabb, point: Vec3, margin: number): boolean {
  return (
    point.x >= box.min.x - margin &&
    point.x <= box.max.x + margin &&
    point.y >= box.min.y - margin &&
    point.y <= box.max.y + margin &&
    point.z >= box.min.z - margin &&
    point.z <= box.max.z + margin
  );
}

export class StrikeDetector {
  private lastStrikeMs = -Infinity;

  constructor(
    private readonly minSpeed: number = MIN_STRIKE_SPEED,
    private readonly cooldownMs: number = STRIKE_COOLDOWN_MS,
  ) {}

  /**
   * @param point where the striking thing is now
   * @param velocity how fast it's travelling, metres per second
   * @returns the strike, or null for a miss, a touch, or a cooldown
   */
  test(
    box: Aabb,
    point: Vec3,
    velocity: Vec3,
    nowMs: number,
    margin = 0.02,
  ): Strike | null {
    if (nowMs - this.lastStrikeMs < this.cooldownMs) return null;
    if (!inside(box, point, margin)) return null;

    const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
    if (speed < this.minSpeed) return null;

    this.lastStrikeMs = nowMs;
    return {
      speed,
      point: { ...point },
      direction: { x: velocity.x / speed, y: velocity.y / speed, z: velocity.z / speed },
    };
  }

  reset(): void {
    this.lastStrikeMs = -Infinity;
  }
}

/**
 * A damped spring on two axes, used to make a struck dummy rock back and
 * settle rather than snapping to an angle and stopping. Critically damped
 * would return without overshoot; this is deliberately under-damped, because
 * the overshoot is the part that reads as "that landed".
 */
export class Wobble {
  private x = 0;
  private z = 0;
  private vx = 0;
  private vz = 0;

  constructor(
    /** Higher = snappier return. */
    private readonly stiffness = 42,
    /** Higher = settles sooner. */
    private readonly damping = 5.2,
    /** Largest lean allowed, radians. */
    private readonly maxLean = 0.42,
  ) {}

  /** Knock it over in a direction, scaled by how hard it was hit. */
  impulse(directionX: number, directionZ: number, strength: number): void {
    this.vx += directionX * strength;
    this.vz += directionZ * strength;
  }

  step(dtSeconds: number): void {
    // Clamp so a stalled frame can't blow the spring up.
    const dt = Math.min(Math.max(dtSeconds, 0), 1 / 30);
    if (dt <= 0) return;

    this.vx += (-this.stiffness * this.x - this.damping * this.vx) * dt;
    this.vz += (-this.stiffness * this.z - this.damping * this.vz) * dt;

    this.x = Math.max(-this.maxLean, Math.min(this.maxLean, this.x + this.vx * dt));
    this.z = Math.max(-this.maxLean, Math.min(this.maxLean, this.z + this.vz * dt));
  }

  /** Lean angles in radians: `x` tips forward/back, `z` tips side to side. */
  get lean(): { x: number; z: number } {
    return { x: this.x, z: this.z };
  }

  get atRest(): boolean {
    return Math.hypot(this.x, this.z) < 1e-3 && Math.hypot(this.vx, this.vz) < 1e-3;
  }

  reset(): void {
    this.x = 0;
    this.z = 0;
    this.vx = 0;
    this.vz = 0;
  }
}
