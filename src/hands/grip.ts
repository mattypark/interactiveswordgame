/**
 * Grip force from vision.
 *
 * The reference build read this off an EMG armband. Without one, finger curl
 * is the honest substitute: measure how far the fingertips sit from the wrist
 * relative to the palm, and you get a clean open-to-closed signal.
 *
 * Measured on `worldLandmarks` (metric 3D) rather than image landmarks, because
 * a hand angled away from the camera foreshortens in 2D and would read as a
 * fist when it is wide open.
 *
 * Pure — no three.js, no DOM.
 */

import { MIDDLE_MCP, WRIST, type Vec3 } from './project.js';

/** Index, middle, ring and pinky tips. The thumb barely moves toward the
 *  wrist when you close your hand, so including it only adds noise. */
const FINGERTIPS = [8, 12, 16, 20] as const;

export interface GripCalibration {
  /** Reach ratio with the hand at rest / open. */
  openRatio: number;
  /** Reach ratio with the hand squeezed shut. */
  fistRatio: number;
}

/** Sensible starting values for an adult hand, before anyone calibrates. */
export const DEFAULT_CALIBRATION: GripCalibration = {
  openRatio: 1.85,
  fistRatio: 1.02,
};

/** Calibration is nonsense unless open and closed are meaningfully apart. */
export const MIN_CALIBRATION_SPREAD = 0.25;

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/**
 * Mean fingertip reach, in palm-lengths. Scale-free, so it reads the same for
 * a small hand and a large one.
 *
 * @returns null when the landmarks can't support a measurement.
 */
export function curlRatio(worldLandmarks: readonly Vec3[]): number | null {
  const wrist = worldLandmarks[WRIST];
  const mcp = worldLandmarks[MIDDLE_MCP];
  if (!wrist || !mcp) return null;

  const palm = distance(wrist, mcp);
  if (palm <= 1e-4) return null;

  let total = 0;
  for (const tip of FINGERTIPS) {
    const point = worldLandmarks[tip];
    if (!point) return null;
    total += distance(point, wrist);
  }

  return total / FINGERTIPS.length / palm;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Reach ratio -> 0 (open) .. 1 (closed), against a calibration. */
export function normaliseGrip(ratio: number, calibration: GripCalibration): number {
  const spread = calibration.openRatio - calibration.fistRatio;
  if (spread <= 0) return 0;
  return clamp01((calibration.openRatio - ratio) / spread);
}

export function isUsableCalibration(calibration: GripCalibration): boolean {
  return calibration.openRatio - calibration.fistRatio >= MIN_CALIBRATION_SPREAD;
}

export type CalibrationStep = 'rest' | 'max';

export interface SampleOutcome {
  ok: boolean;
  /** Median of the samples collected, when ok. */
  ratio: number | null;
  message: string;
}

/** Samples needed before a calibration step will commit. ~0.7s at 30fps. */
export const REQUIRED_SAMPLES = 20;

/**
 * Collects reach ratios while the user holds a pose, then commits the median.
 * The median rather than the mean because a single frame where the model loses
 * a finger produces a wild outlier, and one of those shouldn't move the result.
 */
export class CalibrationSampler {
  private samples: number[] = [];
  private step: CalibrationStep | null = null;

  get active(): boolean {
    return this.step !== null;
  }

  get current(): CalibrationStep | null {
    return this.step;
  }

  get progress(): number {
    return Math.min(1, this.samples.length / REQUIRED_SAMPLES);
  }

  begin(step: CalibrationStep): void {
    this.step = step;
    this.samples = [];
  }

  cancel(): void {
    this.step = null;
    this.samples = [];
  }

  /** Feed one frame. Returns an outcome once enough samples have landed. */
  push(ratio: number | null): SampleOutcome | null {
    if (this.step === null) return null;
    if (ratio !== null) this.samples.push(ratio);
    if (this.samples.length < REQUIRED_SAMPLES) return null;

    const sorted = [...this.samples].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? null;

    const step = this.step;
    this.cancel();

    if (median === null) {
      return { ok: false, ratio: null, message: 'No hand seen — try again in frame.' };
    }
    return {
      ok: true,
      ratio: median,
      message: step === 'rest' ? 'Rest captured.' : 'Squeeze captured.',
    };
  }
}
