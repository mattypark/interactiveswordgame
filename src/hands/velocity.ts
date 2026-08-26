/**
 * Hand velocity, for throwing.
 *
 * Measured over a short window rather than between the last two frames. A
 * two-frame difference at 60fps is mostly tracking noise, and it also catches
 * the exact moment your fingers open — which is when the hand is decelerating,
 * so throws come out limp. Averaging over ~90ms samples the motion of the
 * throw itself.
 *
 * Pure — no three.js, no DOM.
 */

import type { Vec3 } from './project.js';

/** Milliseconds of history to measure across. */
export const WINDOW_MS = 90;

/** Enough samples to cover the window at 120fps, with room to spare. */
const CAPACITY = 16;

interface Sample {
  x: number;
  y: number;
  z: number;
  time: number;
}

export class VelocityTracker {
  private readonly samples: Sample[] = [];

  /** `time` in milliseconds. */
  push(point: Vec3, time: number): void {
    this.samples.push({ x: point.x, y: point.y, z: point.z, time });

    // Drop anything older than the window, always keeping one sample behind it
    // so a slow frame rate still leaves something to measure against.
    while (this.samples.length > 2 && time - this.samples[1]!.time > WINDOW_MS) {
      this.samples.shift();
    }
    while (this.samples.length > CAPACITY) this.samples.shift();
  }

  /** Metres per second over the window, or zero when there isn't enough history. */
  velocity(): Vec3 {
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    if (!first || !last) return { x: 0, y: 0, z: 0 };

    const dt = (last.time - first.time) / 1000;
    if (dt <= 1e-4) return { x: 0, y: 0, z: 0 };

    return {
      x: (last.x - first.x) / dt,
      y: (last.y - first.y) / dt,
      z: (last.z - first.z) / dt,
    };
  }

  get speed(): number {
    const v = this.velocity();
    return Math.hypot(v.x, v.y, v.z);
  }

  reset(): void {
    this.samples.length = 0;
  }
}
