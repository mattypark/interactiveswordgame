import * as THREE from 'three';
import type { HandLandmarkerResult } from '@mediapipe/tasks-vision';

import { Vec3Filter } from './filter';
import { LANDMARK_COUNT } from './connections';
import { HandSkeleton } from './skeleton';
import {
  DEFAULT_PLAY_VOLUME,
  MIDDLE_MCP,
  solveDepth,
  toHandLocal,
  toPlaySpace,
  type FrameSize,
  type PlayVolume,
} from './project';

/** Both hands, tracked and drawn. */
const MAX_HANDS = 2;

/**
 * How long a hand keeps its last pose after tracking drops it. MediaPipe loses
 * a hand for a frame or two fairly often; without this the skeleton strobes.
 */
const HOLD_MS = 180;

export interface HandState {
  present: boolean;
  /** Handedness as reported by the model — 'Left' | 'Right' | null. */
  handedness: string | null;
  /** World-space palm anchor (middle-finger MCP). */
  anchor: THREE.Vector3;
  /** All 21 landmarks in world space. */
  joints: THREE.Vector3[];
  /** Camera distance in metres, before it was mapped into the play volume. */
  depth: number;
  /** 0 = open palm, 1 = closed fist. Filled in from grip.ts. */
  grip: number;
}

class TrackedHand {
  readonly state: HandState = {
    present: false,
    handedness: null,
    anchor: new THREE.Vector3(),
    joints: Array.from({ length: LANDMARK_COUNT }, () => new THREE.Vector3()),
    depth: 0,
    grip: 0,
  };

  readonly skeleton = new HandSkeleton();

  private readonly anchorFilter = new Vec3Filter({ minCutoff: 1.2, beta: 0.02 });
  private readonly jointFilters = Array.from(
    { length: LANDMARK_COUNT },
    () => new Vec3Filter({ minCutoff: 2.4, beta: 0.008 }),
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

    this.state.present = true;
    this.lastSeen = nowMs;
    return true;
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
