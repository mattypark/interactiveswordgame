/**
 * One Euro filter — Casiez, Roussel & Vogel (CHI 2012).
 *
 * Landmark positions jitter, and the size-derived depth in project.ts jitters
 * harder still. A plain exponential average trades that jitter for lag you can
 * feel the moment you try to grab something. One Euro adapts instead: heavy
 * smoothing while the hand is still, almost none while it's moving fast.
 */

const TWO_PI = Math.PI * 2;

function alpha(cutoff: number, dt: number): number {
  const tau = 1 / (TWO_PI * cutoff);
  return 1 / (1 + tau / dt);
}

class LowPass {
  private value = 0;
  private primed = false;

  filter(x: number, a: number): number {
    this.value = this.primed ? a * x + (1 - a) * this.value : x;
    this.primed = true;
    return this.value;
  }

  get last(): number {
    return this.value;
  }

  get ready(): boolean {
    return this.primed;
  }

  reset(): void {
    this.primed = false;
    this.value = 0;
  }
}

export interface OneEuroOptions {
  /** Lower = smoother when still. Hz. */
  minCutoff?: number;
  /** Higher = less lag when moving fast. */
  beta?: number;
  /** Cutoff for the derivative estimate. Hz. */
  dCutoff?: number;
}

export class OneEuroFilter {
  private readonly minCutoff: number;
  private readonly beta: number;
  private readonly dCutoff: number;

  private readonly x = new LowPass();
  private readonly dx = new LowPass();
  private lastTime: number | null = null;

  constructor({ minCutoff = 1.4, beta = 0.012, dCutoff = 1 }: OneEuroOptions = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  /** `time` in seconds. Returns the filtered value. */
  filter(value: number, time: number): number {
    if (this.lastTime === null) {
      this.lastTime = time;
      this.dx.filter(0, 1);
      return this.x.filter(value, 1);
    }

    const dt = time - this.lastTime;
    // Out-of-order or duplicate timestamps would divide by zero or go backwards.
    if (dt <= 0) return this.x.last;
    this.lastTime = time;

    const derivative = this.x.ready ? (value - this.x.last) / dt : 0;
    const speed = Math.abs(this.dx.filter(derivative, alpha(this.dCutoff, dt)));

    const cutoff = this.minCutoff + this.beta * speed;
    return this.x.filter(value, alpha(cutoff, dt));
  }

  reset(): void {
    this.x.reset();
    this.dx.reset();
    this.lastTime = null;
  }
}

/** One filter per component, for smoothing a 3D point. */
export class Vec3Filter {
  private readonly fx: OneEuroFilter;
  private readonly fy: OneEuroFilter;
  private readonly fz: OneEuroFilter;

  constructor(options?: OneEuroOptions) {
    this.fx = new OneEuroFilter(options);
    this.fy = new OneEuroFilter(options);
    this.fz = new OneEuroFilter(options);
  }

  filter(x: number, y: number, z: number, time: number): { x: number; y: number; z: number } {
    return {
      x: this.fx.filter(x, time),
      y: this.fy.filter(y, time),
      z: this.fz.filter(z, time),
    };
  }

  reset(): void {
    this.fx.reset();
    this.fy.reset();
    this.fz.reset();
  }
}
