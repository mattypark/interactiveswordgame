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

  /** Video frames handed to the landmarker since boot. */
  frames: number;
  /** Hands found in the most recent frame. */
  hands: number;
  /** Frames actually returning landmarks, and how many camera sources are live. */
  rx: number;
  sources: number;

  /** Normalised grip force, 0..1, after calibration. */
  force: number;
  calibrated: boolean;

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

  frames: 0,
  hands: 0,
  rx: 0,
  sources: 0,

  force: 0,
  calibrated: false,

  hit: false,
  target: null,
  held: null,
};
