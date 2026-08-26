/**
 * Impact feedback.
 *
 * Borrowed wholesale from how Roblox fighting games sell a hit: the punch
 * itself is a few lines of maths, and everything that makes it feel like a
 * punch is what happens in the fifth of a second afterwards. Hit-stop, a
 * camera kick, a combo count that escalates, and a number that pops off the
 * thing you hit.
 *
 * Pure — no three.js, no DOM.
 */

/** How long the world holds still on a solid hit. Seconds. */
export const HIT_STOP_SECONDS = 0.07;

/** How long a combo survives without another punch. */
export const COMBO_WINDOW_MS = 1100;

/** Combo hits before the count starts reading as a real streak. */
export const COMBO_SHOW_AT = 2;

/**
 * Freezes time briefly on impact.
 *
 * A hit that just subtracts health reads as a number changing. Stopping
 * everything for seventy milliseconds is what makes it read as contact — long
 * enough to register, short enough that it never feels like a stutter.
 */
export class HitStop {
  private remaining = 0;

  get active(): boolean {
    return this.remaining > 0;
  }

  /** `strength` 0..1 scales how long the freeze lasts. */
  hit(strength = 1): void {
    this.remaining = Math.max(
      this.remaining,
      HIT_STOP_SECONDS * (0.6 + 0.4 * Math.max(0, Math.min(1, strength))),
    );
  }

  /**
   * Consume a frame's worth of time.
   * @returns the delta the rest of the game should advance by.
   */
  step(dtSeconds: number): number {
    if (this.remaining <= 0) return dtSeconds;

    this.remaining -= dtSeconds;
    if (this.remaining > 0) return 0;

    // Hand back whatever of the frame was left after the freeze ended, so a
    // long freeze doesn't also cost the frame that ends it.
    const leftover = -this.remaining;
    this.remaining = 0;
    return leftover;
  }

  reset(): void {
    this.remaining = 0;
  }
}

/** Metres of camera displacement at full strength. */
export const SHAKE_AMPLITUDE = 0.022;

/**
 * A decaying camera shake.
 *
 * Deterministic rather than random: a fixed pair of frequencies read as a
 * thump, where noise reads as the camera being broken.
 */
export class Shake {
  private strength = 0;
  private elapsed = 0;

  hit(strength = 1): void {
    this.strength = Math.max(this.strength, Math.max(0, Math.min(1, strength)));
    this.elapsed = 0;
  }

  step(dtSeconds: number): void {
    if (this.strength <= 0) return;
    this.elapsed += dtSeconds;
    // Gone in about a fifth of a second.
    this.strength = Math.max(0, this.strength - dtSeconds * 5);
  }

  /** Current offset, metres. */
  get offset(): { x: number; y: number } {
    if (this.strength <= 0) return { x: 0, y: 0 };
    const amount = SHAKE_AMPLITUDE * this.strength;
    return {
      x: Math.sin(this.elapsed * 61) * amount,
      y: Math.sin(this.elapsed * 47) * amount * 0.7,
    };
  }

  /** Extra field of view on impact, degrees. */
  get fovKick(): number {
    return this.strength * 4.5;
  }

  reset(): void {
    this.strength = 0;
    this.elapsed = 0;
  }
}

/**
 * Consecutive hits inside a rolling window.
 *
 * Rewarding a streak is the cheapest way to make a fight about rhythm rather
 * than about landing one good punch — the count is the reason to keep going.
 */
export class Combo {
  count = 0;
  private lastHitMs = -Infinity;

  /** @returns the new count. */
  hit(nowMs: number): number {
    this.count = nowMs - this.lastHitMs <= COMBO_WINDOW_MS ? this.count + 1 : 1;
    this.lastHitMs = nowMs;
    return this.count;
  }

  update(nowMs: number): void {
    if (this.count > 0 && nowMs - this.lastHitMs > COMBO_WINDOW_MS) this.count = 0;
  }

  /** 0..1 through the window, for a draining timer bar. */
  remaining(nowMs: number): number {
    if (this.count === 0) return 0;
    return Math.max(0, 1 - (nowMs - this.lastHitMs) / COMBO_WINDOW_MS);
  }

  get visible(): boolean {
    return this.count >= COMBO_SHOW_AT;
  }

  reset(): void {
    this.count = 0;
    this.lastHitMs = -Infinity;
  }
}

/** Damage multiplier from a combo — modest, so it rewards without running away. */
export function comboMultiplier(count: number): number {
  return 1 + Math.min(0.5, Math.max(0, count - 1) * 0.12);
}
