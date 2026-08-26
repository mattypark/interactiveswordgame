/**
 * Shared mutable frame state.
 *
 * Written once per frame by the render/tracking loop, read by the HUD on the
 * same tick. Mutation is deliberate — allocating a fresh state object every
 * video frame churns GC at 60fps.
 */

export type ToolMode = 'select' | 'move' | 'rotate' | 'scale' | 'edit' | 'warp';

export type LinkState = 'idle' | 'connecting' | 'connected' | 'error';

export interface Rig {
  mode: ToolMode;

  /** Device/pipeline link states, mirrored to the status dots. */
  camera: LinkState;
  vision: LinkState;
  grip: LinkState;
  /** Face detection, which is optional — you can punch without it. */
  face: LinkState;

  /** Video frames handed to the landmarker since boot. */
  frames: number;
  /** Hands found in the most recent frame. */
  hands: number;
  /** Faces found in the most recent frame. */
  faces: number;
  /** Camera distance to your head, metres. Null when not detected. */
  headDepth: number | null;
  /** Frames actually returning landmarks, and how many camera sources are live. */
  rx: number;
  sources: number;

  /** Normalised grip force, 0..1, after calibration. */
  force: number;
  calibrated: boolean;

  /** Camera distance to the tracked hand, metres. Null when no hand. */
  depth: number | null;
  /** Whether that distance is inside the band the play volume maps. */
  depthInRange: boolean;
  /** Horizontal axis flip. Toggled with M. */
  mirror: boolean;
  /** Depth reads as "push away" rather than literally. Toggled with D. */
  invertDepth: boolean;
  /** Left/right labels swapped. Toggled with H. */
  swapHands: boolean;
  /** A recentre point has been saved. Set with R. */
  originSet: boolean;
  /** Camera perspective. Toggled with V. */
  view: 'third' | 'first';

  /** Strikes landed on the dummy this session. */
  hits: number;
  /** Speed of the most recent strike, metres per second. */
  lastHitSpeed: number | null;

  /** Grab state, surfaced verbatim in the `hit: … target: … held: …` line. */
  hit: boolean;
  target: string | null;
  held: string | null;
}

export const rig: Rig = {
  mode: 'select',

  camera: 'idle',
  vision: 'idle',
  grip: 'idle',
  face: 'idle',

  frames: 0,
  hands: 0,
  faces: 0,
  headDepth: null,
  rx: 0,
  sources: 0,

  force: 0,
  calibrated: false,

  depth: null,
  depthInRange: true,
  mirror: true,
  invertDepth: true,
  swapHands: false,
  originSet: false,
  view: 'third',

  hits: 0,
  lastHitSpeed: null,

  hit: false,
  target: null,
  held: null,
};
