import * as THREE from 'three';
import type { HandLandmarkerResult } from '@mediapipe/tasks-vision';

import { Vec3Filter } from './filter.js';
import { LANDMARK_COUNT } from './connections.js';
import { HandSkeleton } from './skeleton.js';
import { curlRatio } from './grip.js';
import {
  DEFAULT_PLAY_VOLUME,
  MIDDLE_MCP,
  WRIST as WRIST_INDEX,
  solveDepth,
  toHandLocal,
  toPlaySpace,
  type FrameSize,
  type PlayVolume,
} from './project.js';

/** Both hands, tracked and drawn. */
const MAX_HANDS = 2;

/** Landmarks spanning the palm, used to build its orientation. */
const INDEX_MCP = 5;
const PINKY_MCP = 17;

/**
 * How long a hand keeps its last pose after tracking drops it. MediaPipe loses
 * a hand for a frame or two fairly often; without this the skeleton strobes.
 */
const HOLD_MS = 180;

// Reused across frames — this runs twice per frame at 60fps.
const UP = new THREE.Vector3();
const ACROSS = new THREE.Vector3();
const NORMAL = new THREE.Vector3();
const RIGHT = new THREE.Vector3();
const BASIS = new THREE.Matrix4();

export interface HandState {
  present: boolean;
  /** Handedness as reported by the model — 'Left' | 'Right' | null. */
  handedness: string | null;
  /** World-space palm anchor (middle-finger MCP). */
  anchor: THREE.Vector3;
  /** All 21 landmarks in world space. */
  joints: THREE.Vector3[];
  /** Palm orientation, for carrying a grabbed object. */
  orientation: THREE.Quaternion;
  /** Camera distance in metres, before it was mapped into the play volume. */
  depth: number;
  /** 0 = open palm, 1 = closed fist, after calibration. */
  grip: number;
  /** Uncalibrated mean fingertip reach, in palm-lengths. Null when unmeasurable. */
  curl: number | null;
}

class TrackedHand {
  readonly state: HandState = {
    present: false,
    handedness: null,
    anchor: new THREE.Vector3(),
    joints: Array.from({ length: LANDMARK_COUNT }, () => new THREE.Vector3()),
    orientation: new THREE.Quaternion(),
    depth: 0,
    grip: 0,
    curl: null,
  };

  readonly skeleton = new HandSkeleton();

  private readonly anchorFilter = new Vec3Filter({ minCutoff: 1.1, beta: 2.6 });
  private readonly jointFilters = Array.from(
    { length: LANDMARK_COUNT },
    () => new Vec3Filter({ minCutoff: 2.2, beta: 1.4 }),
  );
  private lastSeen = -Infinity;

  /** @returns whether the hand resolved to a usable pose this frame. */
  resolve(
    landmarks: readonly { x: number; y: number; z: number }[],
    worldLandmarks: readonly { x: number; y: number; z: number }[],
    handedness: string | null,
    frame: FrameSize,
    volume: PlayVolume,
    nowMs: number,
  ): boolean {
    const depth = solveDepth(landmarks, worldLandmarks, frame);
    const palm = landmarks[MIDDLE_MCP];
    if (depth === null || !palm) return this.coast(nowMs);

    const timeSec = nowMs / 1000;
    const placed = toPlaySpace(palm, depth, volume);
    const smoothedAnchor = this.anchorFilter.filter(placed.x, placed.y, placed.z, timeSec);

    const local = toHandLocal(worldLandmarks);
    if (local.length < LANDMARK_COUNT) return this.coast(nowMs);

    this.state.anchor.set(smoothedAnchor.x, smoothedAnchor.y, smoothedAnchor.z);
    this.state.depth = depth;
    this.state.handedness = handedness;

    for (let i = 0; i < LANDMARK_COUNT; i += 1) {
      const offset = local[i]!;
      const smoothed = this.jointFilters[i]!.filter(offset.x, offset.y, offset.z, timeSec);
      this.state.joints[i]!.set(
        smoothedAnchor.x + smoothed.x,
        smoothedAnchor.y + smoothed.y,
        smoothedAnchor.z + smoothed.z,
      );
    }

    this.state.curl = curlRatio(worldLandmarks);
    this.solveOrientation();

    this.state.present = true;
    this.lastSeen = nowMs;
    return true;
  }

  /**
   * Build an orthonormal frame for the palm: up the fingers, across the
   * knuckles, and the palm normal from their cross product. Held objects ride
   * this, so twisting a wrist twists the block.
   */
  private solveOrientation(): void {
    const { joints } = this.state;
    const wrist = joints[WRIST_INDEX]!;
    const middle = joints[MIDDLE_MCP]!;
    const index = joints[INDEX_MCP]!;
    const pinky = joints[PINKY_MCP]!;

    UP.subVectors(middle, wrist);
    ACROSS.subVectors(pinky, index);
    if (UP.lengthSq() < 1e-10 || ACROSS.lengthSq() < 1e-10) return;
    UP.normalize();

    NORMAL.crossVectors(ACROSS, UP);
    // A perfectly edge-on palm makes these parallel and the basis degenerate;
    // keeping the previous orientation beats snapping to identity.
    if (NORMAL.lengthSq() < 1e-10) return;
    NORMAL.normalize();

    RIGHT.crossVectors(UP, NORMAL).normalize();

    BASIS.makeBasis(RIGHT, UP, NORMAL);
    this.state.orientation.setFromRotationMatrix(BASIS);
  }

  /** Keep showing the last good pose briefly, then give up. */
  private coast(nowMs: number): boolean {
    if (nowMs - this.lastSeen < HOLD_MS) return this.state.present;
    this.drop();
    return false;
  }

  drop(): void {
    this.state.present = false;
    this.state.grip = 0;
    this.state.curl = null;
    this.anchorFilter.reset();
    for (const filter of this.jointFilters) filter.reset();
  }

  draw(): void {
    if (this.state.present) this.skeleton.update(this.state.joints, this.state.grip);
    else this.skeleton.hide();
  }
}

export class HandsRig {
  readonly group = new THREE.Group();
  readonly hands: TrackedHand[] = Array.from({ length: MAX_HANDS }, () => new TrackedHand());

  volume: PlayVolume = DEFAULT_PLAY_VOLUME;

  constructor() {
    for (const hand of this.hands) this.group.add(hand.skeleton.group);
  }

  get states(): HandState[] {
    return this.hands.map((hand) => hand.state);
  }

  update(result: HandLandmarkerResult | null, frame: FrameSize | null, nowMs: number): void {
    for (let i = 0; i < this.hands.length; i += 1) {
      const hand = this.hands[i]!;
      const landmarks = result?.landmarks[i];
      const worldLandmarks = result?.worldLandmarks[i];

      if (!frame || !landmarks || !worldLandmarks) {
        hand.drop();
      } else {
        const handedness = result?.handedness[i]?.[0]?.categoryName ?? null;
        hand.resolve(landmarks, worldLandmarks, handedness, frame, this.volume, nowMs);
      }

      hand.draw();
    }
  }

  dispose(): void {
    for (const hand of this.hands) hand.skeleton.dispose();
  }
}
