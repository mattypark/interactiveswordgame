import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  EYE_SPACING,
  MAX_HEAD_DEPTH,
  headToPlaySpace,
  headYaw,
  solveHeadDepth,
  type FaceKeypoints,
} from '../src/hands/head.js';
import { DEFAULT_FOV_Y, DEFAULT_PLAY_VOLUME, focalLengthPx } from '../src/hands/project.js';
import type { FrameSize } from '../src/hands/project.js';

const FRAME: FrameSize = { width: 1280, height: 720 };

/** A face at `depth` metres, centred at (cx, cy) in the frame. */
function face(depth: number, cx = 0.5, cy = 0.5, spacing = EYE_SPACING): FaceKeypoints {
  const focal = focalLengthPx(FRAME.height, DEFAULT_FOV_Y);
  // Eyes `spacing` metres apart, perpendicular to the optical axis.
  const halfPx = (focal * spacing) / depth / 2;
  const half = halfPx / FRAME.width;
  return {
    rightEye: { x: cx + half, y: cy },
    leftEye: { x: cx - half, y: cy },
    centre: { x: cx, y: cy },
  };
}

test('head depth recovers the distance it was built from', () => {
  for (const depth of [0.3, 0.45, 0.6, 0.9, 1.4]) {
    const solved = solveHeadDepth(face(depth), FRAME);
    assert.ok(solved !== null, `no solve at ${depth}m`);
    assert.ok(Math.abs(solved - depth) < 1e-6, `solved ${solved} for a head at ${depth}m`);
  }
});

test('a wider-set pair of eyes reads as closer, not as a different person', () => {
  // Someone with 68mm spacing at 50cm looks the same on screen as 63mm at
  // ~46cm. The model assumes the average, so this is expected error, not a
  // bug — the assertion pins its size so a change in EYE_SPACING is noticed.
  const solved = solveHeadDepth(face(0.5, 0.5, 0.5, 0.068), FRAME);
  assert.ok(solved !== null);
  assert.ok(solved < 0.5, 'wider eyes should read as nearer');
  assert.ok(Math.abs(solved - 0.5) < 0.05, `error grew to ${Math.abs(solved - 0.5)}m`);
});

test('head depth refuses frames it cannot measure', () => {
  // Fully side-on: the eye line collapses.
  const sideOn: FaceKeypoints = {
    rightEye: { x: 0.5, y: 0.5 },
    leftEye: { x: 0.5, y: 0.5 },
    centre: { x: 0.5, y: 0.5 },
  };
  assert.equal(solveHeadDepth(sideOn, FRAME), null);

  // Further away than anyone sitting at a computer.
  assert.equal(solveHeadDepth(face(MAX_HEAD_DEPTH * 2), FRAME), null);
});

test('yaw is zero looking straight at the camera and signed when turned', () => {
  const square = face(0.5);
  assert.ok(Math.abs(headYaw(square)) < 1e-9);

  // Box centre drifting toward one eye is the head turning that way.
  const turned: FaceKeypoints = { ...square, centre: { x: square.rightEye.x, y: 0.5 } };
  assert.ok(headYaw(turned) > 0.5);

  const other: FaceKeypoints = { ...square, centre: { x: square.leftEye.x, y: 0.5 } };
  assert.ok(headYaw(other) < -0.5);

  // Clamped, so a bad detection can't spin the character.
  const wild: FaceKeypoints = { ...square, centre: { x: 5, y: 0.5 } };
  assert.ok(Math.abs(headYaw(wild)) <= 1);
});

test('a degenerate eye line yaws zero rather than dividing by nothing', () => {
  const collapsed: FaceKeypoints = {
    rightEye: { x: 0.5, y: 0.5 },
    leftEye: { x: 0.5, y: 0.5 },
    centre: { x: 0.7, y: 0.5 },
  };
  assert.equal(headYaw(collapsed), 0);
});

test('the head maps into the same volume as the hands', () => {
  const volume = DEFAULT_PLAY_VOLUME;
  const midDepth = (volume.nearDepth + volume.farDepth) / 2;

  const centred = headToPlaySpace(face(midDepth), midDepth, volume);
  assert.ok(Math.abs(centred.x - volume.centre.x) < 1e-9);
  assert.ok(Math.abs(centred.y - volume.centre.y) < 1e-9);
  assert.ok(Math.abs(centred.z - volume.centre.z) < 1e-9);

  // Leaning moves it, and the same way a hand would move.
  const leaned = headToPlaySpace(face(midDepth, 0.3, 0.5), midDepth, volume);
  assert.ok(Math.abs(leaned.x - volume.centre.x) > 0.05);
});
