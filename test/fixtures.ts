/**
 * Synthetic hands, shared by the grip and projection tests. Roughly to scale
 * for an adult hand, in MediaPipe world-landmark axes: metres, origin near the
 * palm centre, x right, y DOWN, z toward the camera.
 */

import type { Vec3 } from '../src/hands/project.js';

function points(rows: ReadonlyArray<readonly [number, number, number]>): Vec3[] {
  return rows.map(([x, y, z]) => ({ x, y, z }));
}

/** Fingers extended. */
export const OPEN_HAND: Vec3[] = points([
  [0.0, 0.09, 0.0],
  [-0.035, 0.075, 0.005],
  [-0.055, 0.045, 0.01],
  [-0.068, 0.02, 0.012],
  [-0.078, 0.0, 0.014],
  [-0.032, 0.005, 0.0],
  [-0.036, -0.03, 0.0],
  [-0.038, -0.052, 0.0],
  [-0.039, -0.07, 0.0],
  [-0.008, 0.0, 0.0],
  [-0.009, -0.037, 0.0],
  [-0.01, -0.061, 0.0],
  [-0.01, -0.08, 0.0],
  [0.016, 0.004, 0.0],
  [0.018, -0.032, 0.0],
  [0.019, -0.055, 0.0],
  [0.02, -0.072, 0.0],
  [0.038, 0.014, 0.0],
  [0.043, -0.015, 0.0],
  [0.045, -0.033, 0.0],
  [0.046, -0.048, 0.0],
]);

/** How far each joint is pulled back toward the palm when the fist closes. */
const CURL: Record<number, number> = {
  3: 0.4, 4: 0.6,
  6: 0.55, 7: 0.85, 8: 0.95,
  10: 0.55, 11: 0.85, 12: 0.95,
  14: 0.55, 15: 0.85, 16: 0.95,
  18: 0.55, 19: 0.85, 20: 0.95,
};

/** The same hand squeezed shut. */
export const FIST_HAND: Vec3[] = OPEN_HAND.map((point, index) => {
  const t = CURL[index];
  if (t === undefined) return { ...point };
  return {
    x: point.x * (1 - t * 0.45),
    y: point.y + (0 - point.y) * t,
    z: point.z + t * 0.035,
  };
});

/** Uniformly scaled copy, for checking scale invariance. */
export function scaleHand(hand: readonly Vec3[], factor: number): Vec3[] {
  return hand.map((point) => ({ x: point.x * factor, y: point.y * factor, z: point.z * factor }));
}
