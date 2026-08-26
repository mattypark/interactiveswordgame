/**
 * Guided first-run setup.
 *
 * Two things have to be measured before this feels right, and neither is
 * discoverable from a pair of unlabelled buttons: where the middle of your
 * reach is, and how far your fingers travel between open and closed. This
 * walks through both.
 *
 * The centre is captured from the same pose as the "rest" grip sample, because
 * they're the same thing — an open hand held comfortably in front of you.
 *
 * Every capture requires the hand to be *still* first. Grabbing the centre on
 * the first frame a hand appears catches it mid-way through being raised into
 * frame, which is how you end up centred on the far right of your reach.
 *
 * Pure — no three.js, no DOM.
 */

import { isUsableCalibration, type GripCalibration } from '../hands/grip.js';

export type SetupStep = 'idle' | 'centre' | 'squeeze' | 'done';

/** Hand speed below which we call it still. Metres per second. */
export const STILL_SPEED = 0.09;

/** Consecutive still frames required before a capture commits. ~0.5s at 30fps. */
export const STILL_FRAMES = 16;

export interface SetupFrame {
  present: boolean;
  /** Raw normalised image position of the palm. */
  raw: { x: number; y: number };
  /** Camera distance, metres. */
  depth: number;
  /** Uncalibrated reach ratio, or null when unmeasurable. */
  curl: number | null;
  /** How fast the hand is moving, metres per second. */
  speed: number;
}

export interface SetupResult {
  origin: { y: number; depth: number };
  calibration: GripCalibration;
}

export class SetupFlow {
  step: SetupStep = 'idle';
  /** 0..1 toward the current capture. */
  progress = 0;
  /** What to tell the user right now. */
  prompt = '';

  private stillFrames = 0;
  private samples: number[] = [];
  private origin: SetupResult['origin'] | null = null;
  private openRatio = 0;

  /** Set once the whole flow finishes, and read by the caller. */
  result: SetupResult | null = null;

  get running(): boolean {
    return this.step === 'centre' || this.step === 'squeeze';
  }

  start(): void {
    this.step = 'centre';
    this.reset();
    this.prompt = 'Hold your hand open where it feels comfortable, and keep still';
  }

  cancel(): void {
    this.step = 'idle';
    this.reset();
    this.prompt = '';
  }

  private reset(): void {
    this.stillFrames = 0;
    this.progress = 0;
    this.samples = [];
  }

  /** Median, so one frame where the model loses a finger can't skew a capture. */
  private median(): number | null {
    if (this.samples.length === 0) return null;
    const sorted = [...this.samples].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] ?? null;
  }

  update(frame: SetupFrame): void {
    if (!this.running) return;

    if (!frame.present) {
      this.reset();
      this.prompt =
        this.step === 'centre'
          ? 'Show your hand to the camera'
          : 'Show your hand to the camera';
      return;
    }

    if (frame.speed > STILL_SPEED) {
      // Moving — start the count over rather than averaging in a swing.
      this.reset();
      this.prompt =
        this.step === 'centre'
          ? 'Hold your hand open where it feels comfortable, and keep still'
          : 'Squeeze, and keep still';
      return;
    }

    this.stillFrames += 1;
    if (frame.curl !== null) this.samples.push(frame.curl);
    this.progress = Math.min(1, this.stillFrames / STILL_FRAMES);

    this.prompt =
      this.step === 'centre' ? 'Hold it there…' : 'Keep squeezing…';

    if (this.stillFrames < STILL_FRAMES) return;

    const ratio = this.median();
    if (ratio === null) {
      // Still frames but no usable reading — keep waiting rather than
      // committing a number we don't have.
      this.reset();
      this.prompt = 'Move your hand fully into frame';
      return;
    }

    if (this.step === 'centre') {
      // Height and distance only — horizontal stays tied to the camera frame.
      this.origin = { y: frame.raw.y, depth: frame.depth };
      this.openRatio = ratio;
      this.step = 'squeeze';
      this.reset();
      this.prompt = 'Now make a fist and hold it';
      return;
    }

    const calibration: GripCalibration = { openRatio: this.openRatio, fistRatio: ratio };
    if (!isUsableCalibration(calibration)) {
      // Open and closed came out too alike — almost always the fist wasn't
      // actually made. Say so instead of keeping a mapping that won't work.
      this.reset();
      this.prompt = 'That looked the same as your open hand — squeeze harder';
      return;
    }

    this.result = { origin: this.origin!, calibration };
    this.step = 'done';
    this.progress = 1;
    this.prompt = 'All set';
  }

  /** Read the result once and clear it. */
  take(): SetupResult | null {
    const result = this.result;
    this.result = null;
    return result;
  }
}
