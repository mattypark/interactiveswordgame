import * as THREE from 'three';

import { Vision } from '../hands/vision.js';
import { HandsRig, setSwapHandedness, type HandState } from '../hands/hands.js';
import { normaliseGrip } from '../hands/grip.js';
import { VelocityTracker } from '../hands/velocity.js';
import { Vec3Filter } from '../hands/filter.js';
import { headToPlaySpace, headYaw, solveHeadDepth, type FaceKeypoints } from '../hands/head.js';
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

export interface HeadState {
  present: boolean;
  /** World-space head position, in the same volume as the hands. */
  position: THREE.Vector3;
  /** Camera distance, metres. */
  depth: number;
  /** -1 fully left, +1 fully right, 0 square on. */
  yaw: number;
}

/** How long the head keeps its last pose after detection drops it. */
const HEAD_HOLD_MS = 260;

/** Half a head's width, metres — the radius a punch has to land inside. */
const HEAD_RADIUS = 0.095;

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

  readonly head: HeadState = {
    present: false,
    position: new THREE.Vector3(),
    depth: 0,
    yaw: 0,
  };

  /**
   * A ring where your head is. In a fight this is the thing being aimed at, so
   * it has to be visible — you can't dodge a hitbox you can't see.
   */
  private readonly headMarker: THREE.Mesh;

  // A head moves far less than a hand, so it can be smoothed much harder.
  private readonly headFilter = new Vec3Filter({ minCutoff: 0.8, beta: 0.5 });
  private headLastSeen = -Infinity;

  private setupOffered = false;

  constructor(
    private readonly hud: Hud,
    private readonly onViewChange: (mode: ViewMode) => void,
  ) {
    this.volumeView = new PlayVolumeView(this.hands.volume);

    this.headMarker = new THREE.Mesh(
      new THREE.SphereGeometry(HEAD_RADIUS, 18, 12),
      new THREE.MeshBasicMaterial({
        color: 0x8fa8d8,
        wireframe: true,
        transparent: true,
        opacity: 0.42,
      }),
    );
    this.headMarker.visible = false;
    this.runtimes = this.hands.hands.map((hand) => ({
      state: hand.state,
      velocity: new VelocityTracker(),
    }));
  }

  /** Added to the scene once; both game modes draw over the top of it. */
  addTo(scene: THREE.Scene): void {
    scene.add(this.hands.group, this.volumeView.group, this.headMarker);
  }

  /** Radius of the head hitbox, metres. */
  get headRadius(): number {
    return HEAD_RADIUS;
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
        this.setup.start(performance.now());
        return true;

      case 'setup':
        if (action.action === 'start') this.setup.start(performance.now());
        else if (action.action === 'capture') this.setup.captureNow();
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

    this.updateSetup(visible, nowMs);

    for (const runtime of this.runtimes) {
      const { state, velocity } = runtime;
      state.grip =
        state.present && state.curl !== null
          ? normaliseGrip(state.curl, this.calibration.calibration)
          : 0;

      if (state.present) velocity.push(state.anchor, nowMs);
      else velocity.reset();
    }

    this.updateHead(nowMs);

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

  /**
   * Resolve the head from the latest detection.
   *
   * The detector hands back a bounding box and six keypoints; only the eyes
   * and the box centre are used — the eye spacing for distance, the centre for
   * position.
   */
  private updateHead(nowMs: number): void {
    const detection = this.vision.latestFace;
    const frame = this.vision.frameSize;

    const rightEye = detection?.keypoints?.[0];
    const leftEye = detection?.keypoints?.[1];
    const box = detection?.boundingBox;

    if (!detection || !frame || !rightEye || !leftEye || !box) {
      this.coastHead(nowMs);
      return;
    }

    const face: FaceKeypoints = {
      rightEye: { x: rightEye.x, y: rightEye.y },
      leftEye: { x: leftEye.x, y: leftEye.y },
      // The box is in pixels; everything downstream works in normalised space.
      centre: {
        x: (box.originX + box.width / 2) / frame.width,
        y: (box.originY + box.height / 2) / frame.height,
      },
    };

    const depth = solveHeadDepth(face, frame);
    if (depth === null) {
      this.coastHead(nowMs);
      return;
    }

    const placed = headToPlaySpace(face, depth, this.hands.volume);
    const smoothed = this.headFilter.filter(placed.x, placed.y, placed.z, nowMs / 1000);

    this.head.position.set(smoothed.x, smoothed.y, smoothed.z);
    this.head.depth = depth;
    this.head.yaw = headYaw(face);
    this.head.present = true;
    this.headLastSeen = nowMs;

    this.headMarker.position.copy(this.head.position);
    this.headMarker.visible = true;

    rig.headDepth = depth;
  }

  private coastHead(nowMs: number): void {
    if (nowMs - this.headLastSeen < HEAD_HOLD_MS) return;
    this.head.present = false;
    this.headFilter.reset();
    this.headMarker.visible = false;
    rig.headDepth = null;
  }

  private updateSetup(visible: HandState | null, nowMs: number): void {
    // Offer it once, the first time there's a hand to work with.
    if (!this.setupOffered && !this.setup.running && visible) {
      this.setupOffered = true;
      this.setup.start(nowMs);
    }

    if (this.setup.running) {
      this.setup.update(
        visible
          ? {
              present: true,
              raw: visible.raw,
              depth: visible.depth,
              curl: visible.curl,
              position: visible.anchor,
              now: nowMs,
            }
          : {
              present: false,
              raw: { x: 0.5, y: 0.5 },
              depth: 0,
              curl: null,
              position: { x: 0, y: 0, z: 0 },
              now: nowMs,
            },
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
            steadiness: this.setup.steadiness,
          }
        : null,
    );
  }

  /** Show or hide the tracking overlay geometry with the menus. */
  setVisible(visible: boolean): void {
    this.hands.group.visible = visible;
    this.volumeView.setVisible(visible);
    // Your own head marker would sit in your face in first person.
    this.headMarker.visible = visible && this.head.present && rig.view === 'third';
  }
}
