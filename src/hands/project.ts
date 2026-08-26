/**
 * Landmarks -> world space.
 *
 * The reference build got depth from two cameras. With one camera the trick is
 * that MediaPipe hands out two things at once: `landmarks` in normalised image
 * space, and `worldLandmarks` in *metres*. Measure the same bone in both and
 * the pinhole model gives absolute distance:
 *
 *     z = focalPx * lengthMetres / lengthPixels
 *
 * Deliberately free of three.js so it can be unit-tested under plain node.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Landmark2D {
  x: number;
  y: number;
}

export interface FrameSize {
  width: number;
  height: number;
}

/** Landmark indices, from the MediaPipe hand topology. */
export const WRIST = 0;
export const MIDDLE_MCP = 9;

/**
 * Vertical field of view of a typical laptop webcam. Nothing exposes the real
 * value to the browser, so this is the one number worth tuning if depth reads
 * consistently too near or too far.
 */
export const DEFAULT_FOV_Y = (60 * Math.PI) / 180;

/** Distances outside this are tracking noise, not a hand. Metres. */
export const MIN_DEPTH = 0.15;
export const MAX_DEPTH = 1.4;

export function focalLengthPx(frameHeight: number, fovY: number = DEFAULT_FOV_Y): number {
  return (0.5 * frameHeight) / Math.tan(fovY / 2);
}

function distance3(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function distancePx(a: Landmark2D, b: Landmark2D, frame: FrameSize): number {
  return Math.hypot((a.x - b.x) * frame.width, (a.y - b.y) * frame.height);
}

/**
 * Distance from the camera to the hand, in metres.
 *
 * Uses wrist -> middle-finger MCP as the reference bone: it spans the palm, so
 * it stays long enough to measure accurately, and unlike anything involving a
 * fingertip its length doesn't change when you close your fist.
 */
export function solveDepth(
  landmarks: readonly Landmark2D[],
  worldLandmarks: readonly Vec3[],
  frame: FrameSize,
  fovY: number = DEFAULT_FOV_Y,
): number | null {
  const imageWrist = landmarks[WRIST];
  const imageMcp = landmarks[MIDDLE_MCP];
  const worldWrist = worldLandmarks[WRIST];
  const worldMcp = worldLandmarks[MIDDLE_MCP];
  if (!imageWrist || !imageMcp || !worldWrist || !worldMcp) return null;

  const lengthPx = distancePx(imageWrist, imageMcp, frame);
  const lengthMetres = distance3(worldWrist, worldMcp);
  // A hand edge-on can project the palm bone to almost nothing; that frame
  // carries no usable depth information.
  if (lengthPx < 1 || lengthMetres <= 0) return null;

  const depth = (focalLengthPx(frame.height, fovY) * lengthMetres) / lengthPx;
  if (!Number.isFinite(depth) || depth < MIN_DEPTH || depth > MAX_DEPTH) return null;

  return depth;
}

/**
 * Full pinhole unprojection of an image point at a known depth, into
 * camera-space metres with three.js axes (x right, y up, z toward the viewer).
 * Not used for placing the hand — see `toPlaySpace` for why — but it is the
 * ground truth `solveDepth` is checked against.
 */
export function unproject(
  point: Landmark2D,
  depth: number,
  frame: FrameSize,
  fovY: number = DEFAULT_FOV_Y,
): Vec3 {
  const focal = focalLengthPx(frame.height, fovY);
  return {
    x: ((point.x - 0.5) * frame.width * depth) / focal,
    y: (-(point.y - 0.5) * frame.height * depth) / focal,
    z: depth,
  };
}

/**
 * The box in world space your hand sweeps through, and the slice of camera
 * space that maps onto it.
 */
export interface PlayVolume {
  centre: Vec3;
  /** Full width/height/depth of the box, metres. */
  size: Vec3;
  /** Camera distances mapped to the near and far faces of the box, metres. */
  nearDepth: number;
  farDepth: number;
}

export const DEFAULT_PLAY_VOLUME: PlayVolume = {
  centre: { x: 0, y: 0.18, z: 0 },
  size: { x: 0.62, y: 0.4, z: 0.42 },
  nearDepth: 0.28,
  farDepth: 0.62,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Maps t from [a,b] onto [-0.5, 0.5], clamped. */
function normalise(value: number, a: number, b: number): number {
  return clamp((value - a) / (b - a), 0, 1) - 0.5;
}

/**
 * Place the hand in the scene.
 *
 * X and Y come from normalised image position rather than a true unprojection.
 * Unprojecting is physically correct but means the reachable box narrows as you
 * bring your hand closer to the camera, which feels broken to play with. A
 * straight sweep of the frame onto the box keeps the whole volume reachable at
 * any distance. Depth is the one axis that uses the real metric solve.
 *
 * X is mirrored so the scene behaves like a mirror: move right, the hand on
 * screen goes right.
 */
export function toPlaySpace(
  point: Landmark2D,
  depth: number,
  volume: PlayVolume = DEFAULT_PLAY_VOLUME,
): Vec3 {
  const u = 0.5 - point.x; // mirrored, [-0.5, 0.5]
  const v = 0.5 - point.y; // image y is down; world y is up

  // Near the camera should read as near the viewer, so the depth axis inverts.
  const w = -normalise(depth, volume.nearDepth, volume.farDepth);

  return {
    x: volume.centre.x + clamp(u, -0.5, 0.5) * volume.size.x,
    y: volume.centre.y + clamp(v, -0.5, 0.5) * volume.size.y,
    z: volume.centre.z + w * volume.size.z,
  };
}

/**
 * Rotate MediaPipe's metric hand into three.js axes and re-origin it on the
 * middle-finger MCP, so the joints hang off the anchor `toPlaySpace` produced.
 *
 * All three components negate: x for the selfie mirror, y because image space
 * points down, z because MediaPipe measures depth away from the viewer. The
 * net transform is improper — which is correct, a mirror image of a left hand
 * is a right hand.
 */
export function toHandLocal(worldLandmarks: readonly Vec3[]): Vec3[] {
  const origin = worldLandmarks[MIDDLE_MCP];
  if (!origin) return [];

  return worldLandmarks.map((landmark) => ({
    x: -(landmark.x - origin.x),
    y: -(landmark.y - origin.y),
    z: -(landmark.z - origin.z),
  }));
}
