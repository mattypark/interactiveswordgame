/**
 * The NPC's behaviour, as a state machine over a rectangle of floor.
 *
 * It paces, it turns to face you when you're close, and it staggers when hit
 * before getting back to what it was doing. Deliberately simple: the point is
 * something that moves and reacts, so hitting a moving target is different
 * from hitting the static dummy.
 *
 * Pure — no three.js, no DOM.
 */

export type NpcState = 'patrol' | 'face' | 'stagger';

export interface NpcBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface NpcOptions {
  bounds: NpcBounds;
  /** Metres per second while pacing. */
  speed: number;
  /** Within this distance of the player it stops and turns to face them. */
  noticeRadius: number;
  /** How long a stagger lasts, seconds. */
  staggerSeconds: number;
  /** Metres of knockback per metre-per-second of impact. */
  knockbackPerSpeed: number;
}

export const DEFAULT_NPC: NpcOptions = {
  // Off to one side of the dummy, so both are visible and reachable.
  bounds: { minX: 0.02, maxX: 0.3, minZ: -0.38, maxZ: -0.14 },
  speed: 0.19,
  noticeRadius: 0.34,
  staggerSeconds: 0.55,
  knockbackPerSpeed: 0.045,
};

const TWO_PI = Math.PI * 2;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Shortest signed angle from `from` to `to`. */
export function angleDelta(from: number, to: number): number {
  let delta = (to - from) % TWO_PI;
  if (delta > Math.PI) delta -= TWO_PI;
  if (delta < -Math.PI) delta += TWO_PI;
  return delta;
}

export class NpcBrain {
  x: number;
  z: number;
  /** Radians, 0 = facing +z (toward the player). */
  facing = 0;
  state: NpcState = 'patrol';
  /** 0..1, how far into the current stagger. Drives the lean. */
  staggerAmount = 0;

  private direction = 1;
  private staggerLeft = 0;
  private knockX = 0;
  private knockZ = 0;

  constructor(private readonly options: NpcOptions = DEFAULT_NPC) {
    const { bounds } = options;
    this.x = (bounds.minX + bounds.maxX) / 2;
    this.z = (bounds.minZ + bounds.maxZ) / 2;
  }

  /** Knock it back and interrupt whatever it was doing. */
  hit(direction: { x: number; z: number }, speed: number): void {
    const push = speed * this.options.knockbackPerSpeed;
    this.knockX = direction.x * push;
    this.knockZ = direction.z * push;
    this.staggerLeft = this.options.staggerSeconds;
    this.state = 'stagger';
    // Set here, not on the next update: a renderer reading this on the same
    // frame as the hit would otherwise draw it standing calmly upright.
    this.staggerAmount = 1;
  }

  /**
   * @param dtSeconds time since last update
   * @param player where the hand is, or null when nothing is tracked
   */
  update(dtSeconds: number, player: { x: number; z: number } | null): void {
    const dt = Math.min(Math.max(dtSeconds, 0), 1 / 20);
    if (dt <= 0) return;

    const { bounds, speed, noticeRadius, staggerSeconds } = this.options;

    if (this.staggerLeft > 0) {
      this.staggerLeft = Math.max(0, this.staggerLeft - dt);
      this.staggerAmount = this.staggerLeft / staggerSeconds;

      // Knockback decays over the stagger rather than teleporting.
      this.x += this.knockX * dt * 4;
      this.z += this.knockZ * dt * 4;
      this.knockX *= 0.86;
      this.knockZ *= 0.86;

      if (this.staggerLeft === 0) {
        this.state = 'patrol';
        this.staggerAmount = 0;
      }
    } else {
      const distance = player
        ? Math.hypot(player.x - this.x, player.z - this.z)
        : Infinity;

      if (distance < noticeRadius) {
        // Stand your ground and watch them.
        this.state = 'face';
      } else {
        this.state = 'patrol';
        this.x += this.direction * speed * dt;

        // Turn around at the ends of its beat.
        if (this.x > bounds.maxX) this.direction = -1;
        else if (this.x < bounds.minX) this.direction = 1;
      }
    }

    this.x = clamp(this.x, bounds.minX, bounds.maxX);
    this.z = clamp(this.z, bounds.minZ, bounds.maxZ);

    // Face the player when they're near, otherwise face where it's walking.
    const desired =
      this.state === 'patrol'
        ? this.direction > 0
          ? Math.PI / 2
          : -Math.PI / 2
        : player
          ? Math.atan2(player.x - this.x, player.z - this.z)
          : this.facing;

    // Ease rather than snap, so it reads as turning rather than teleporting.
    this.facing += angleDelta(this.facing, desired) * Math.min(1, dt * 7);
  }
}
