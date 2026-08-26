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
  /**
   * Whether to flip the horizontal axis.
   *
   * Which way round this belongs depends on the camera and how you read the
   * scene, and getting it backwards is immediately obvious and immediately
   * annoying — so it is a runtime toggle (press M), not a buried constant.
   */
  mirror: boolean;
  /**
   * Which way the depth axis runs.
   *
   * false is the literal reading: hand near the lens, object near the viewer.
   * true is the push reading: shove your hand toward the camera and the object
   * is pushed away from you into the scene. The second is what most people
   * reach for, so it's the default — toggled with D.
   */
  invertDepth: boolean;
  /**
   * A recentre point: the height and distance treated as the middle of the box.
   *
   * Deliberately **not** horizontal. Left-right in the camera frame is already
   * well behaved — the middle of the frame is the middle of the box and the
   * edges are the edges — so recentring it just shifts everything sideways and
   * makes the middle of your view read as off to one side.
   *
   * Height and distance are the two that genuinely vary: people hold their
   * hand low in frame, and sit anywhere from 30cm to 70cm from the lens.
   * Null means use the frame default.
   */
  origin: { y: number; depth: number } | null;
}

export const DEFAULT_PLAY_VOLUME: PlayVolume = {
  // Sits the resting hand well clear of the floor. The old centre put the
  // bottom of the vertical range at ground level, so a hand held low in frame
  // read as lying on the grid.
  centre: { x: 0, y: 0.32, z: 0 },
  size: { x: 0.72, y: 0.44, z: 1.15 },
  // A wide depth band, because reaching toward and away from the camera is the
  // one axis a single webcam gives you and it should be worth using: near the
  // lens throws the block right up to the viewer, arm's length pushes it deep
  // into the scene, and perspective does the rest.
  // A band you can actually sweep with your forearm. The old 24-86cm was the
  // full range the tracker resolves, not the range a person comfortably moves
  // through — most of the box sat outside where anyone's hand goes, so a
  // normal sitting distance already read as "all the way forward".
  nearDepth: 0.3,
  farDepth: 0.62,
  mirror: true,
  invertDepth: true,
  origin: null,
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
 * Whether X is flipped is `volume.mirror`, toggled at runtime — see PlayVolume.
 */
export function toPlaySpace(
  point: Landmark2D,
  depth: number,
  volume: PlayVolume = DEFAULT_PLAY_VOLUME,
): Vec3 {
  const origin = volume.origin;
  const midDepth = (volume.nearDepth + volume.farDepth) / 2;

  // Recentring shifts the whole mapping so the saved hand position lands in
  // the middle of the box, rather than assuming you sit square to the camera.
  // Horizontal is never shifted — see PlayVolume.origin.
  const px = point.x;
  const py = origin ? point.y - origin.y + 0.5 : point.y;
  const pz = origin ? depth - origin.depth + midDepth : depth;

  const u = volume.mirror ? 0.5 - px : px - 0.5; // [-0.5, 0.5]
  const v = 0.5 - py; // image y is down; world y is up

  const w = normalise(pz, volume.nearDepth, volume.farDepth);
  const depthAxis = volume.invertDepth ? w : -w;

  return {
    x: volume.centre.x + clamp(u, -0.5, 0.5) * volume.size.x,
    y: volume.centre.y + clamp(v, -0.5, 0.5) * volume.size.y,
    z: volume.centre.z + depthAxis * volume.size.z,
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
