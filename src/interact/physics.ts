/**
 * A small ballistic integrator — just enough to make a thrown block behave.
 *
 * Deliberately not a physics engine. Blocks fly, fall, bounce once or twice
 * and settle; they don't stack or collide with each other. That covers what
 * throwing needs without pulling in a WASM rigid-body library, and it keeps
 * the whole thing testable under plain node.
 *
 * Pure — no three.js, no DOM.
 */

import type { Vec3 } from '../hands/project.js';

export interface Bounds {
  min: Vec3;
  max: Vec3;
}

export interface PhysicsOptions {
  /** Metres per second squared, negative is down. */
  gravity: number;
  /** Fraction of speed kept per second of flight. Air resistance. */
  drag: number;
  /** Fraction of speed kept across a bounce. */
  restitution: number;
  /** Below this speed a resting body is put to sleep. Metres per second. */
  sleepSpeed: number;
  /** The room the block flies around in. */
  bounds: Bounds;
}

export const DEFAULT_PHYSICS: PhysicsOptions = {
  gravity: -3.2,
  drag: 0.55,
  restitution: 0.42,
  sleepSpeed: 0.06,
  bounds: {
    min: { x: -1.6, y: 0, z: -1.6 },
    max: { x: 1.6, y: 2.2, z: 1.6 },
  },
};

export interface Body {
  position: Vec3;
  velocity: Vec3;
  /** Half-extent, so the block rests on the floor rather than in it. */
  radius: number;
  awake: boolean;
}

/** Longest step we'll integrate at once — a backgrounded tab must not teleport. */
export const MAX_STEP = 1 / 30;

function bounceAxis(
  position: number,
  velocity: number,
  low: number,
  high: number,
  restitution: number,
): { position: number; velocity: number } {
  if (position < low) return { position: low, velocity: Math.abs(velocity) * restitution };
  if (position > high) return { position: high, velocity: -Math.abs(velocity) * restitution };
  return { position, velocity };
}

/**
 * Advance one body. Mutates it, because this runs per frame per object and
 * allocating vectors here would churn GC.
 */
export function step(body: Body, dtSeconds: number, options: PhysicsOptions): void {
  if (!body.awake) return;

  const dt = Math.min(Math.max(dtSeconds, 0), MAX_STEP);
  if (dt <= 0) return;

  body.velocity.y += options.gravity * dt;

  // Exponential drag, so the result doesn't depend on frame rate.
  const keep = Math.pow(options.drag, dt);
  body.velocity.x *= keep;
  body.velocity.y *= keep;
  body.velocity.z *= keep;

  body.position.x += body.velocity.x * dt;
  body.position.y += body.velocity.y * dt;
  body.position.z += body.velocity.z * dt;

  const { min, max } = options.bounds;
  const r = body.radius;

  const x = bounceAxis(body.position.x, body.velocity.x, min.x + r, max.x - r, options.restitution);
  body.position.x = x.position;
  body.velocity.x = x.velocity;

  const z = bounceAxis(body.position.z, body.velocity.z, min.z + r, max.z - r, options.restitution);
  body.position.z = z.position;
  body.velocity.z = z.velocity;

  const floor = min.y + r;
  if (body.position.y <= floor) {
    body.position.y = floor;
    body.velocity.y = Math.abs(body.velocity.y) * options.restitution;

    // Friction, but only while actually touching the ground.
    body.velocity.x *= 0.72;
    body.velocity.z *= 0.72;

    const speed = Math.hypot(body.velocity.x, body.velocity.y, body.velocity.z);
    if (speed < options.sleepSpeed) {
      body.velocity.x = 0;
      body.velocity.y = 0;
      body.velocity.z = 0;
      body.awake = false;
    }
  } else if (body.position.y >= max.y - r) {
    body.position.y = max.y - r;
    body.velocity.y = -Math.abs(body.velocity.y) * options.restitution;
  }
}

/** Fastest throw we'll honour, so a tracking glitch can't fire it into orbit. */
export const MAX_THROW_SPEED = 4.5;

export function clampThrow(velocity: Vec3, max: number = MAX_THROW_SPEED): Vec3 {
  const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
  if (speed <= max || speed === 0) return { ...velocity };
  const scale = max / speed;
  return { x: velocity.x * scale, y: velocity.y * scale, z: velocity.z * scale };
}
