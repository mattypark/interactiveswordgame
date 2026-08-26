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
 * Steadiness is judged by **how far the hand has wandered over the last
 * three-quarters of a second**, not by counting consecutive frames under a
 * speed threshold. Tracking jitter produces speed spikes constantly; a
 * consecutive-frame counter is reset to zero by any one of them and can hang
 * forever without ever telling you why. Positional spread ignores the spikes
 * and measures the thing actually being asked for — a hand that is staying
 * put. A sliding window also means progress degrades and recovers rather than
 * snapping back to nothing.
 *
 * Pure — no three.js, no DOM.
 */

import { isUsableCalibration, type GripCalibration } from '../hands/grip.js';

export type SetupStep = 'idle' | 'centre' | 'squeeze' | 'done';

/** How long the hand has to stay put. */
export const HOLD_MS = 750;

/** How far it may wander in that time and still count as still. Metres. */
export const STILL_SPREAD = 0.055;

/** Fewest readings a capture will commit on. */
export const MIN_SAMPLES = 6;

/**
 * After this long on one step, commit with whatever has been gathered rather
 * than waiting for a stillness some cameras and some hands will never reach.
 * Being approximately calibrated beats being stuck.
 */
export const TIMEOUT_MS = 7000;

/** Losing the hand for longer than this abandons the readings so far. */
const LOST_GRACE_MS = 1500;

/**
 * Spread is measured between these percentiles rather than between the extremes.
 *
 * Tracking spikes are exactly the thing this must ignore: a hand held
 * perfectly still while the tracker throws a 12cm outlier every few frames has
 * a full-range spread of 12cm forever, and a min/max test would refuse to
 * calibrate it. Trimming the ends measures where the hand actually is.
 */
const LOW_PERCENTILE = 0.15;
const HIGH_PERCENTILE = 0.85;

/** How long a correction stays on screen before normal prompts resume. */
const MESSAGE_MS = 2200;

export interface SetupFrame {
  present: boolean;
  /** Raw normalised image position of the palm. */
  raw: { x: number; y: number };
  /** Camera distance, metres. */
  depth: number;
  /** Uncalibrated reach ratio, or null when unmeasurable. */
  curl: number | null;
  /** World-space palm position — what steadiness is measured on. */
  position: { x: number; y: number; z: number };
  /** Milliseconds. */
  now: number;
}

export interface SetupResult {
  origin: { y: number; depth: number };
  calibration: GripCalibration;
}

interface Sample {
  t: number;
  x: number;
  y: number;
  z: number;
  curl: number | null;
  rawY: number;
  depth: number;
}

/** Range between the trimmed percentiles of `values`. */
function trimmedRange(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const low = sorted[Math.floor((sorted.length - 1) * LOW_PERCENTILE)] ?? 0;
  const high = sorted[Math.ceil((sorted.length - 1) * HIGH_PERCENTILE)] ?? 0;
  return high - low;
}

function now0(samples: readonly { t: number }[]): number {
  return samples[samples.length - 1]?.t ?? 0;
}

export class SetupFlow {
  step: SetupStep = 'idle';
  /** 0..1 toward the current capture. */
  progress = 0;
  /** What to tell the user right now. */
  prompt = '';
  /** How still the hand is, 0..1. Drives the "hold still" feedback. */
  steadiness = 0;

  private samples: Sample[] = [];
  private stepStarted = 0;
  private lastSeen = 0;
  private openRatio = 0;
  private origin: SetupResult['origin'] | null = null;
  /** Until this time, `prompt` holds a correction the user needs to read. */
  private promptUntil = 0;

  /** Set once the whole flow finishes, and read by the caller. */
  result: SetupResult | null = null;

  get running(): boolean {
    return this.step === 'centre' || this.step === 'squeeze';
  }

  start(now = 0): void {
    this.step = 'centre';
    this.beginStep(now);
    this.prompt = 'Hold your hand open where it feels comfortable';
  }

  cancel(): void {
    this.step = 'idle';
    this.samples = [];
    this.progress = 0;
    this.steadiness = 0;
    this.prompt = '';
  }

  private beginStep(now: number): void {
    this.samples = [];
    this.progress = 0;
    this.steadiness = 0;
    this.stepStarted = now;
    this.lastSeen = now;
    this.promptUntil = 0;
  }

  /** Commit the current step on demand, if there's anything to commit. */
  captureNow(): boolean {
    if (!this.running || this.samples.length < MIN_SAMPLES) return false;
    return this.commit();
  }

  update(frame: SetupFrame): void {
    if (!this.running) return;

    if (!frame.present) {
      // Brief dropouts are routine; only a real absence throws away readings.
      if (frame.now - this.lastSeen > LOST_GRACE_MS) {
        this.samples = [];
        this.progress = 0;
        this.steadiness = 0;
      }
      this.prompt = 'Show your hand to the camera';
      return;
    }

    this.lastSeen = frame.now;
    this.samples.push({
      t: frame.now,
      x: frame.position.x,
      y: frame.position.y,
      z: frame.position.z,
      curl: frame.curl,
      rawY: frame.raw.y,
      depth: frame.depth,
    });
    // Measure before pruning: pruning to exactly HOLD_MS would leave the span
    // permanently a frame short of it, and the capture would never fire.
    const span = frame.now - (this.samples[0]?.t ?? frame.now);
    while (this.samples.length > 2 && frame.now - this.samples[0]!.t > HOLD_MS * 1.25) {
      this.samples.shift();
    }
    const spread = this.spread();
    this.steadiness = Math.max(0, Math.min(1, 1 - spread / STILL_SPREAD));

    // Progress is how full the window is, weighted by how still it has been —
    // so it eases back under wobble instead of snapping to zero.
    this.progress = Math.min(1, span / HOLD_MS) * (0.35 + 0.65 * this.steadiness);

    const timedOut = frame.now - this.stepStarted > TIMEOUT_MS;
    const ready = this.samples.length >= MIN_SAMPLES && span >= HOLD_MS;

    if (ready && spread <= STILL_SPREAD) {
      this.commit();
      return;
    }

    if (timedOut && this.samples.length >= MIN_SAMPLES) {
      // Good enough beats stuck.
      this.commit();
      return;
    }

    // Don't talk over a correction the user is still reading.
    if (frame.now < this.promptUntil) return;

    this.prompt =
      this.steadiness < 0.45
        ? this.step === 'centre'
          ? 'Almost — hold your hand steadier'
          : 'Almost — keep the fist steady'
        : this.step === 'centre'
          ? 'Hold it there…'
          : 'Keep squeezing…';
  }

  /** Trimmed wander on the widest axis across the window, metres. */
  private spread(): number {
    if (this.samples.length < 3) return Infinity;

    return Math.max(
      trimmedRange(this.samples.map((sample) => sample.x)),
      trimmedRange(this.samples.map((sample) => sample.y)),
      trimmedRange(this.samples.map((sample) => sample.z)),
    );
  }

  /** Median, so one frame where the model loses a finger can't skew a capture. */
  private medianCurl(): number | null {
    const readings = this.samples
      .map((sample) => sample.curl)
      .filter((curl): curl is number => curl !== null)
      .sort((a, b) => a - b);
    return readings.length === 0 ? null : (readings[Math.floor(readings.length / 2)] ?? null);
  }

  private medianOrigin(): { y: number; depth: number } {
    const ys = this.samples.map((sample) => sample.rawY).sort((a, b) => a - b);
    const depths = this.samples.map((sample) => sample.depth).sort((a, b) => a - b);
    return {
      y: ys[Math.floor(ys.length / 2)] ?? 0.5,
      depth: depths[Math.floor(depths.length / 2)] ?? 0.45,
    };
  }

  /** @returns whether the step actually committed. */
  private commit(): boolean {
    const ratio = this.medianCurl();
    if (ratio === null) {
      // Readings but nothing measurable in them: keep waiting rather than
      // storing a number we don't have.
      this.say('Move your whole hand into frame', now0(this.samples));
      this.samples = [];
      return false;
    }

    const now = this.samples[this.samples.length - 1]?.t ?? this.stepStarted;

    if (this.step === 'centre') {
      this.origin = this.medianOrigin();
      this.openRatio = ratio;
      this.step = 'squeeze';
      this.beginStep(now);
      // Sticky: the next frame's normal prompt would otherwise replace the
      // instruction before anyone has read it.
      this.say('Now make a fist and hold it', now);
      return true;
    }

    const calibration: GripCalibration = { openRatio: this.openRatio, fistRatio: ratio };
    if (!isUsableCalibration(calibration)) {
      // Open and closed came out too alike — almost always the fist wasn't
      // actually made. Say so instead of keeping a mapping that won't work.
      this.beginStep(now);
      this.say('That looked like your open hand — squeeze tighter and hold', now);
      return false;
    }

    this.result = { origin: this.origin!, calibration };
    this.step = 'done';
    this.progress = 1;
    this.steadiness = 1;
    this.prompt = 'All set';
    return true;
  }

  /** Show a correction and protect it from being immediately overwritten. */
  private say(text: string, now: number): void {
    this.prompt = text;
    this.promptUntil = now + MESSAGE_MS;
  }

  /** Read the result once and clear it. */
  take(): SetupResult | null {
    const result = this.result;
    this.result = null;
    return result;
  }
}
