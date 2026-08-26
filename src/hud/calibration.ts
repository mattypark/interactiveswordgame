import {
  CalibrationSampler,
  DEFAULT_CALIBRATION,
  REQUIRED_SAMPLES,
  isUsableCalibration,
  type CalibrationStep,
  type GripCalibration,
} from '../hands/grip.js';

/**
 * The two-step calibration from the reference build: hold your hand at rest,
 * then squeeze. It maps *your* range onto the 0-100% force bar, which matters
 * because reach ratios vary a lot between hands.
 */
export class CalibrationFlow {
  private readonly sampler = new CalibrationSampler();
  private working: GripCalibration = { ...DEFAULT_CALIBRATION };

  calibration: GripCalibration = { ...DEFAULT_CALIBRATION };
  calibrated = false;
  status = 'Ready';

  begin(step: CalibrationStep): void {
    this.sampler.begin(step);
    this.status = step === 'rest' ? 'Hold your hand open…' : 'Squeeze…';
  }

  reset(): void {
    this.sampler.cancel();
    this.working = { ...DEFAULT_CALIBRATION };
    this.calibration = { ...DEFAULT_CALIBRATION };
    this.calibrated = false;
    this.status = 'Ready';
  }

  /** Feed one frame's reach ratio. Null when no hand is visible. */
  update(ratio: number | null): void {
    if (!this.sampler.active) return;

    const step = this.sampler.current;
    const outcome = this.sampler.push(ratio);

    if (!outcome) {
      const collected = Math.round(this.sampler.progress * REQUIRED_SAMPLES);
      this.status = `Sampling ${collected}/${REQUIRED_SAMPLES}…`;
      return;
    }

    if (!outcome.ok || outcome.ratio === null) {
      this.status = outcome.message;
      return;
    }

    if (step === 'rest') this.working.openRatio = outcome.ratio;
    else this.working.fistRatio = outcome.ratio;

    if (isUsableCalibration(this.working)) {
      this.calibration = { ...this.working };
      this.calibrated = true;
      this.status = 'Calibrated';
    } else {
      // Both steps captured but too close together — usually the second pose
      // wasn't held. Say so instead of silently keeping a useless mapping.
      this.calibrated = false;
      this.status =
        step === 'rest' ? `${outcome.message} Now squeeze.` : 'Rest and squeeze look alike — redo.';
    }
  }
}
