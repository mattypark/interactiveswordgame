import * as THREE from 'three';
import type { HandLandmarkerResult } from '@mediapipe/tasks-vision';

import { OneEuroFilter, Vec3Filter } from './filter.js';
import { LANDMARK_COUNT } from './connections.js';
import { HandSkeleton, type HandColorKey } from './skeleton.js';
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

/**
 * The model reports handedness for the raw image. Whether that matches the
 * hand you're actually holding up depends on the camera, so it's swappable at
 * runtime (H) rather than assumed — same reasoning as the mirror toggle.
 */
export let swapHandedness = false;

export function setSwapHandedness(value: boolean): void {
  swapHandedness = value;
}

function paletteFor(handedness: string | null): HandColorKey {
  if (handedness === 'Left') return swapHandedness ? 'right' : 'left';
  if (handedness === 'Right') return swapHandedness ? 'left' : 'right';
  return 'unknown';
}

/** Frames of raw depth kept for the median. Odd, so there's a true middle. */
const DEPTH_WINDOW = 5;

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
  /** Raw normalised image position of the palm, for saving a recentre point. */
  raw: { x: number; y: number };
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
    raw: { x: 0.5, y: 0.5 },
    grip: 0,
    curl: null,
  };

  readonly skeleton = new HandSkeleton();

  /**
   * Depth gets its own filter, applied before the mapping rather than after.
   *
   * It is by far the noisiest channel — it comes from a bone a few dozen
   * pixels long, so a pixel of wobble is a couple of centimetres of distance —
   * and the play volume stretches a 32cm band across 1.15m of scene, which
   * multiplies that wobble by three and a half. Smoothing it downstream, mixed
   * in with clean x and y, meant either the jitter came through or x and y got
   * dragged down with it.
   */
  private readonly depthFilter = new OneEuroFilter({ minCutoff: 0.45, beta: 0.2 });
  /** Last few raw depths, for throwing out spikes. */
  private readonly depthWindow: number[] = [];

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
    const rawDepth = solveDepth(landmarks, worldLandmarks, frame);
    const palm = landmarks[MIDDLE_MCP];
    if (rawDepth === null || !palm) return this.coast(nowMs);

    const timeSec = nowMs / 1000;
    const depth = this.depthFilter.filter(this.despike(rawDepth), timeSec);
    const placed = toPlaySpace(palm, depth, volume);
    const smoothedAnchor = this.anchorFilter.filter(placed.x, placed.y, placed.z, timeSec);

    const local = toHandLocal(worldLandmarks);
    if (local.length < LANDMARK_COUNT) return this.coast(nowMs);

    this.state.anchor.set(smoothedAnchor.x, smoothedAnchor.y, smoothedAnchor.z);
    this.state.depth = depth;
    this.state.raw.x = palm.x;
    this.state.raw.y = palm.y;
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

  /**
   * Median of the last three raw depths. A frame where the model briefly
   * mis-sizes the palm produces a single wild reading, and a low-pass filter
   * spreads that over the following frames instead of rejecting it.
   */
  private despike(depth: number): number {
    this.depthWindow.push(depth);
    if (this.depthWindow.length > DEPTH_WINDOW) this.depthWindow.shift();
    if (this.depthWindow.length < 3) return depth;

    const sorted = [...this.depthWindow].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)]!;
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
    this.depthFilter.reset();
    this.depthWindow.length = 0;
    for (const filter of this.jointFilters) filter.reset();
  }

  draw(): void {
    if (!this.state.present) {
      this.skeleton.hide();
      return;
    }
    this.skeleton.setPalette(paletteFor(this.state.handedness));
    this.skeleton.update(this.state.joints, this.state.grip);
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

  /** Treat this hand height and distance as the middle of the volume. */
  recentre(raw: { y: number }, depth: number): void {
    this.volume = { ...this.volume, origin: { y: raw.y, depth } };
  }

  clearOrigin(): void {
    this.volume = { ...this.volume, origin: null };
  }

  dispose(): void {
    for (const hand of this.hands) hand.skeleton.dispose();
  }
}
