import * as THREE from 'three';

import { Vision } from '../hands/vision.js';
import { HandsRig, setSwapHandedness, type HandState } from '../hands/hands.js';
import { normaliseGrip } from '../hands/grip.js';
import { VelocityTracker } from '../hands/velocity.js';
import { PlayVolumeView } from '../scene/volume.js';
import { CalibrationFlow } from '../hud/calibration.js';
import { SetupFlow } from '../hud/setup.js';
import type { Hud, HudAction } from '../hud/hud.js';
import type { ViewMode } from '../scene/stage.js';
import { rig } from '../state/rig.js';

/**
 * Everything between the camera and a pair of hands in world space: capture,
 * landmarking, calibration, the guided setup and the volume marker.
 *
 * Owned by the shell rather than by a game mode, because it keeps running
 * while you're reading the menu — the model finishes loading and the camera
 * warms up before the first frame of play, not during it.
 */

export interface HandRuntime {
  state: HandState;
  velocity: VelocityTracker;
}

const SETUP_STEP_LABEL: Record<string, string> = {
  centre: 'Step 1 of 2 · centre',
  squeeze: 'Step 2 of 2 · grip',
};

export class Tracking {
  readonly hands = new HandsRig();
  readonly vision = new Vision();
  readonly calibration = new CalibrationFlow();
  readonly setup = new SetupFlow();
  readonly volumeView: PlayVolumeView;

  readonly runtimes: HandRuntime[];

  private setupOffered = false;

  constructor(
    private readonly hud: Hud,
    private readonly onViewChange: (mode: ViewMode) => void,
  ) {
    this.volumeView = new PlayVolumeView(this.hands.volume);
    this.runtimes = this.hands.hands.map((hand) => ({
      state: hand.state,
      velocity: new VelocityTracker(),
    }));
  }

  /** Added to the scene once; both game modes draw over the top of it. */
  addTo(scene: THREE.Scene): void {
    scene.add(this.hands.group, this.volumeView.group);
  }

  async start(video: HTMLVideoElement): Promise<void> {
    await this.vision.start(video);
  }

  /** True while the setup overlay is up — nothing should be playable. */
  get busy(): boolean {
    return this.setup.running;
  }

  get states(): HandState[] {
    return this.runtimes.map((runtime) => runtime.state);
  }

  /** The first tracked hand, or null. */
  primary(): HandState | null {
    return this.runtimes.find((runtime) => runtime.state.present)?.state ?? null;
  }

  /**
   * Handle a HUD action if it belongs to tracking.
   * @returns whether it was consumed.
   */
  handle(action: HudAction): boolean {
    switch (action.type) {
      case 'calibrate':
        if (action.step === 'reset') {
          this.calibration.reset();
          this.hands.clearOrigin();
        }
        this.setup.start();
        return true;

      case 'setup':
        if (action.action === 'start') this.setup.start();
        else {
          this.setup.cancel();
          this.setupOffered = true;
        }
        return true;

      case 'mirror':
        rig.mirror = !rig.mirror;
        this.hands.volume = { ...this.hands.volume, mirror: rig.mirror };
        return true;

      case 'invert-depth':
        rig.invertDepth = !rig.invertDepth;
        this.hands.volume = { ...this.hands.volume, invertDepth: rig.invertDepth };
        return true;

      case 'swap-hands':
        rig.swapHands = !rig.swapHands;
        setSwapHandedness(rig.swapHands);
        return true;

      case 'toggle-view':
        rig.view = rig.view === 'third' ? 'first' : 'third';
        this.onViewChange(rig.view);
        return true;

      case 'set-origin': {
        const hand = this.primary();
        if (hand) this.hands.recentre(hand.raw, hand.depth);
        else this.hands.clearOrigin();
        rig.originSet = this.hands.volume.origin !== null;
        return true;
      }

      default:
        return false;
    }
  }

  update(nowMs: number): void {
    this.vision.update();
    this.hands.update(this.vision.latest, this.vision.frameSize, nowMs);

    const visible = this.primary();
    this.calibration.update(visible?.curl ?? null);

    const visibleRuntime = this.runtimes.find((runtime) => runtime.state.present);
    this.updateSetup(visible, visibleRuntime?.velocity.speed ?? 0);

    for (const runtime of this.runtimes) {
      const { state, velocity } = runtime;
      state.grip =
        state.present && state.curl !== null
          ? normaliseGrip(state.curl, this.calibration.calibration)
          : 0;

      if (state.present) velocity.push(state.anchor, nowMs);
      else velocity.reset();
    }

    const primary = this.primary();
    rig.depth = primary ? primary.depth : null;
    rig.depthInRange =
      rig.depth === null ||
      (rig.depth >= this.hands.volume.nearDepth && rig.depth <= this.hands.volume.farDepth);
    this.volumeView.setHand(primary ? primary.anchor : null, rig.depthInRange);

    rig.originSet = this.hands.volume.origin !== null;
    rig.force = primary?.grip ?? 0;
    rig.calibrated = this.calibration.calibrated;
  }

  private updateSetup(visible: HandState | null, handSpeed: number): void {
    // Offer it once, the first time there's a hand to work with.
    if (!this.setupOffered && !this.setup.running && visible) {
      this.setupOffered = true;
      this.setup.start();
    }

    if (this.setup.running) {
      this.setup.update(
        visible
          ? {
              present: true,
              raw: visible.raw,
              depth: visible.depth,
              curl: visible.curl,
              speed: handSpeed,
            }
          : { present: false, raw: { x: 0.5, y: 0.5 }, depth: 0, curl: null, speed: 0 },
      );
    }

    const done = this.setup.take();
    if (done) {
      this.hands.recentre(done.origin, done.origin.depth);
      this.calibration.apply(done.calibration);
    }

    this.hud.setSetup(
      this.setup.running
        ? {
            step: SETUP_STEP_LABEL[this.setup.step] ?? 'Setup',
            prompt: this.setup.prompt,
            progress: this.setup.progress,
          }
        : null,
    );
  }

  /** Show or hide the tracking overlay geometry with the menus. */
  setVisible(visible: boolean): void {
    this.hands.group.visible = visible;
    this.volumeView.setVisible(visible);
  }
}
