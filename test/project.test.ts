/**
 * The depth solve is the load-bearing trick of the whole project: it's what
 * replaces the reference build's second camera. These tests build synthetic
 * hands at known distances through a textbook pinhole and check the solver
 * recovers the distance it was given.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_FOV_Y,
  DEFAULT_PLAY_VOLUME,
  MAX_DEPTH,
  MIDDLE_MCP,
  WRIST,
  focalLengthPx,
  solveDepth,
  toHandLocal,
  toPlaySpace,
  unproject,
  type FrameSize,
  type Landmark2D,
  type Vec3,
} from '../src/hands/project.js';

const FRAME: FrameSize = { width: 1280, height: 720 };

/** A hand whose palm bone is `metres` long, held `depth` metres from the camera. */
function syntheticHand(depth: number, metres = 0.09, frame: FrameSize = FRAME) {
  const focal = focalLengthPx(frame.height, DEFAULT_FOV_Y);
  // A bone perpendicular to the optical axis projects to f * L / Z pixels.
  const lengthPx = (focal * metres) / depth;

  const landmarks: Landmark2D[] = new Array(21).fill(null).map(() => ({ x: 0.5, y: 0.5 }));
  landmarks[WRIST] = { x: 0.5, y: 0.5 };
  landmarks[MIDDLE_MCP] = { x: 0.5, y: 0.5 - lengthPx / frame.height };

  const worldLandmarks: Vec3[] = new Array(21).fill(null).map(() => ({ x: 0, y: 0, z: 0 }));
  worldLandmarks[WRIST] = { x: 0, y: 0, z: 0 };
  worldLandmarks[MIDDLE_MCP] = { x: 0, y: -metres, z: 0 };

  return { landmarks, worldLandmarks };
}

test('focal length matches the pinhole definition', () => {
  const focal = focalLengthPx(720, DEFAULT_FOV_Y);
  assert.ok(Math.abs(focal - 360 / Math.tan(DEFAULT_FOV_Y / 2)) < 1e-9);
  // A wider field of view means a shorter focal length.
  assert.ok(focalLengthPx(720, (90 * Math.PI) / 180) < focal);
});

test('depth solve recovers the distance it was built from', () => {
  for (const depth of [0.25, 0.35, 0.5, 0.75, 1.0]) {
    const { landmarks, worldLandmarks } = syntheticHand(depth);
    const solved = solveDepth(landmarks, worldLandmarks, FRAME);
    assert.ok(solved !== null, `no solve at ${depth}m`);
    assert.ok(
      Math.abs(solved - depth) < 1e-6,
      `solved ${solved} for a hand placed at ${depth}m`,
    );
  }
});

test('depth solve is independent of hand size, given metric landmarks', () => {
  // A child's hand and an adult's at the same distance must solve the same,
  // because worldLandmarks carry the real size.
  const small = syntheticHand(0.4, 0.07);
  const large = syntheticHand(0.4, 0.11);
  const a = solveDepth(small.landmarks, small.worldLandmarks, FRAME);
  const b = solveDepth(large.landmarks, large.worldLandmarks, FRAME);
  assert.ok(a !== null && b !== null);
  assert.ok(Math.abs(a - b) < 1e-6);
});

test('depth solve refuses frames it cannot measure', () => {
  const { landmarks, worldLandmarks } = syntheticHand(0.4);

  // Palm edge-on: the bone projects to nothing.
  const collapsed = landmarks.map((point) => ({ ...point }));
  collapsed[MIDDLE_MCP] = { ...collapsed[WRIST] };
  assert.equal(solveDepth(collapsed, worldLandmarks, FRAME), null);

  // Zero-length metric bone — a model failure, not a pose.
  const flatWorld = worldLandmarks.map(() => ({ x: 0, y: 0, z: 0 }));
  assert.equal(solveDepth(landmarks, flatWorld, FRAME), null);

  // Beyond arm's reach: noise, not a hand.
  const tooFar = syntheticHand(MAX_DEPTH * 2);
  assert.equal(solveDepth(tooFar.landmarks, tooFar.worldLandmarks, FRAME), null);

  // Truncated landmark arrays must not throw.
  assert.equal(solveDepth([], [], FRAME), null);
});

test('unproject inverts the pinhole projection', () => {
  const focal = focalLengthPx(FRAME.height);
  const original = { x: 0.11, y: -0.06, z: 0.45 };

  // Project by hand: image y grows downward, so it takes the sign flip.
  const point: Landmark2D = {
    x: (original.x * focal) / original.z / FRAME.width + 0.5,
    y: 0.5 - (original.y * focal) / original.z / FRAME.height,
  };

  const round = unproject(point, original.z, FRAME);
  assert.ok(Math.abs(round.x - original.x) < 1e-9);
  assert.ok(Math.abs(round.y - original.y) < 1e-9);
  assert.equal(round.z, original.z);
});

test('play space centres a centred hand at mid depth', () => {
  const volume = DEFAULT_PLAY_VOLUME;
  const midDepth = (volume.nearDepth + volume.farDepth) / 2;
  const placed = toPlaySpace({ x: 0.5, y: 0.5 }, midDepth, volume);

  assert.ok(Math.abs(placed.x - volume.centre.x) < 1e-9);
  assert.ok(Math.abs(placed.y - volume.centre.y) < 1e-9);
  assert.ok(Math.abs(placed.z - volume.centre.z) < 1e-9);
});

test('the mirror flag flips the horizontal axis, and only that', () => {
  const midDepth = (DEFAULT_PLAY_VOLUME.nearDepth + DEFAULT_PLAY_VOLUME.farDepth) / 2;
  const mirrored = { ...DEFAULT_PLAY_VOLUME, mirror: true };
  const direct = { ...DEFAULT_PLAY_VOLUME, mirror: false };

  const leftOfImage = { x: 0.0, y: 0.5 };
  const a = toPlaySpace(leftOfImage, midDepth, mirrored);
  const b = toPlaySpace(leftOfImage, midDepth, direct);

  assert.ok(a.x > DEFAULT_PLAY_VOLUME.centre.x);
  assert.ok(b.x < DEFAULT_PLAY_VOLUME.centre.x);
  // Equal and opposite about the centre.
  assert.ok(Math.abs(a.x - DEFAULT_PLAY_VOLUME.centre.x + (b.x - DEFAULT_PLAY_VOLUME.centre.x)) < 1e-9);

  // Vertical and depth are untouched by the flag.
  assert.equal(a.y, b.y);
  assert.equal(a.z, b.z);
});

test('play space lifts vertically', () => {
  const volume = DEFAULT_PLAY_VOLUME;
  const midDepth = (volume.nearDepth + volume.farDepth) / 2;

  // Top of the image is up in the world.
  const top = toPlaySpace({ x: 0.5, y: 0.0 }, midDepth, volume);
  assert.ok(top.y > volume.centre.y);

  const bottom = toPlaySpace({ x: 0.5, y: 1.0 }, midDepth, volume);
  assert.ok(bottom.y < volume.centre.y);
});

test('the depth axis runs the way invertDepth says', () => {
  const pushed = { ...DEFAULT_PLAY_VOLUME, invertDepth: true };
  const literal = { ...DEFAULT_PLAY_VOLUME, invertDepth: false };
  const centre = { x: 0.5, y: 0.5 };

  // Push reading: hand toward the lens shoves the object away into the scene.
  const pushNear = toPlaySpace(centre, pushed.nearDepth, pushed);
  const pushFar = toPlaySpace(centre, pushed.farDepth, pushed);
  assert.ok(pushNear.z < pushFar.z, 'a hand near the lens should push the object away');

  // Literal reading: the exact opposite.
  const litNear = toPlaySpace(centre, literal.nearDepth, literal);
  const litFar = toPlaySpace(centre, literal.farDepth, literal);
  assert.ok(litNear.z > litFar.z);

  // Mirror images of each other about the centre.
  assert.ok(Math.abs(pushNear.z + litNear.z - 2 * DEFAULT_PLAY_VOLUME.centre.z) < 1e-9);
});

test('depth outside the band pins to the face of the box', () => {
  const volume = DEFAULT_PLAY_VOLUME;
  const centre = { x: 0.5, y: 0.5 };

  const near = toPlaySpace(centre, volume.nearDepth, volume);
  const far = toPlaySpace(centre, volume.farDepth, volume);

  const wayTooClose = toPlaySpace(centre, 0.01, volume);
  const wayTooFar = toPlaySpace(centre, 10, volume);
  assert.ok(Math.abs(wayTooClose.z - near.z) < 1e-9);
  assert.ok(Math.abs(wayTooFar.z - far.z) < 1e-9);

  const halfDepth = volume.size.z / 2;
  assert.ok(Math.abs(Math.abs(near.z - volume.centre.z) - halfDepth) < 1e-9);
});

test('recentring puts the saved height and distance at the middle of the box', () => {
  // Hand held low in frame and closer than mid — a real sitting pose.
  const origin = { y: 0.66, depth: 0.36 };
  const volume = { ...DEFAULT_PLAY_VOLUME, origin };

  const centred = toPlaySpace({ x: 0.5, y: origin.y }, origin.depth, volume);
  assert.ok(Math.abs(centred.y - volume.centre.y) < 1e-9);
  assert.ok(Math.abs(centred.z - volume.centre.z) < 1e-9);

  // Without recentring, that same pose is well below and behind the middle.
  const uncentred = toPlaySpace({ x: 0.5, y: origin.y }, origin.depth, DEFAULT_PLAY_VOLUME);
  assert.ok(Math.abs(uncentred.y - volume.centre.y) > 0.05);
  assert.ok(Math.abs(uncentred.z - volume.centre.z) > 0.05);
});

test('recentring never shifts you sideways', () => {
  // The bug this guards: recentring horizontally means returning to the middle
  // of your camera view reads as being off to one side of the box.
  const origin = { y: 0.66, depth: 0.36 };
  const volume = { ...DEFAULT_PLAY_VOLUME, origin };

  for (const x of [0, 0.25, 0.5, 0.75, 1]) {
    const withOrigin = toPlaySpace({ x, y: 0.5 }, 0.45, volume);
    const without = toPlaySpace({ x, y: 0.5 }, 0.45, DEFAULT_PLAY_VOLUME);
    assert.ok(
      Math.abs(withOrigin.x - without.x) < 1e-12,
      `x moved from ${without.x} to ${withOrigin.x} at frame x=${x}`,
    );
  }

  // The middle of the frame is still the middle of the box, recentred or not.
  assert.ok(Math.abs(toPlaySpace({ x: 0.5, y: 0.5 }, 0.45, volume).x - volume.centre.x) < 1e-12);
});

test('a resting hand sits clear of the floor', () => {
  const volume = DEFAULT_PLAY_VOLUME;
  // Even at the very bottom of the frame, the hand should not be in the grid.
  const lowest = toPlaySpace({ x: 0.5, y: 1 }, 0.45, volume);
  assert.ok(lowest.y > 0.05, `bottom of the range is at y=${lowest.y}`);
});

test('hand-local landmarks re-origin on the MCP and mirror', () => {
  const world: Vec3[] = new Array(21).fill(null).map(() => ({ x: 0, y: 0, z: 0 }));
  world[MIDDLE_MCP] = { x: 0.01, y: -0.02, z: 0.03 };
  world[WRIST] = { x: 0.04, y: 0.02, z: 0.01 };

  const local = toHandLocal(world);
  const mcp = local[MIDDLE_MCP];
  const wrist = local[WRIST];
  assert.ok(mcp && wrist);

  // The anchor joint lands exactly on the origin.
  assert.deepEqual(mcp, { x: -0, y: -0, z: -0 });

  // Every axis flips: x mirrors the selfie view, y and z convert image axes.
  assert.ok(Math.abs(wrist.x - -(0.04 - 0.01)) < 1e-12);
  assert.ok(Math.abs(wrist.y - -(0.02 - -0.02)) < 1e-12);
  assert.ok(Math.abs(wrist.z - -(0.01 - 0.03)) < 1e-12);

  assert.deepEqual(toHandLocal([]), []);
});
