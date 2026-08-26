/**
 * Where your head is, in world space.
 *
 * Same trick the hands use, with a different known length: the distance
 * between a person's pupils is remarkably consistent — about 63mm for adults,
 * varying far less than head width or height — so measuring it in pixels gives
 * distance through the same pinhole model.
 *
 * Pure — no three.js, no DOM.
 */

import {
  focalLengthPx,
  type FrameSize,
  type Landmark2D,
  type PlayVolume,
  type Vec3,
  DEFAULT_FOV_Y,
  toPlaySpace,
} from './project.js';

/** Mean adult interpupillary distance, metres. */
export const EYE_SPACING = 0.063;

/** Outside this, it isn't a person sitting at a computer. Metres. */
export const MIN_HEAD_DEPTH = 0.2;
export const MAX_HEAD_DEPTH = 2.0;

export interface FaceKeypoints {
  /** Detector keypoints; the first two are the eyes. */
  rightEye: Landmark2D;
  leftEye: Landmark2D;
  /** Centre of the detection box, normalised. */
  centre: Landmark2D;
}

/**
 * Distance from the camera to the head, in metres.
 * @returns null when the eyes are too close together in pixels to measure.
 */
export function solveHeadDepth(
  face: FaceKeypoints,
  frame: FrameSize,
  fovY: number = DEFAULT_FOV_Y,
): number | null {
  const dx = (face.rightEye.x - face.leftEye.x) * frame.width;
  const dy = (face.rightEye.y - face.leftEye.y) * frame.height;
  const spacingPx = Math.hypot(dx, dy);

  // A head turned fully side-on foreshortens the eye line to nothing, and
  // that frame carries no usable distance.
  if (spacingPx < 4) return null;

  const depth = (focalLengthPx(frame.height, fovY) * EYE_SPACING) / spacingPx;
  if (!Number.isFinite(depth) || depth < MIN_HEAD_DEPTH || depth > MAX_HEAD_DEPTH) return null;

  return depth;
}

/**
 * Which way the head is turned, from how far the nose-line sits between the
 * eyes. -1 is fully left, +1 fully right, 0 is square on.
 *
 * Approximate by design — it drives a lean, not a hit test.
 */
export function headYaw(face: FaceKeypoints): number {
  const span = face.rightEye.x - face.leftEye.x;
  if (Math.abs(span) < 1e-4) return 0;
  const midpoint = (face.rightEye.x + face.leftEye.x) / 2;
  return Math.max(-1, Math.min(1, ((face.centre.x - midpoint) / Math.abs(span)) * 2));
}

/** Head position in world space, using the same volume as the hands. */
export function headToPlaySpace(
  face: FaceKeypoints,
  depth: number,
  volume: PlayVolume,
): Vec3 {
  return toPlaySpace(face.centre, depth, volume);
}
