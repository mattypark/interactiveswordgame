import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  MIN_ALIGNMENT,
  MIN_PUNCH_SPEED,
  PUNCH_COOLDOWN_MS,
  PUNCH_REACH,
  PunchDetector,
  alignmentTo,
  punchDamage,
} from '../src/game/punch.js';

const HEAD = { x: 0, y: 0.35, z: -0.3 };
const HEAD_RADIUS = 0.095;
/** A fist just outside reach, lined up on the head. */
const FIST = { x: 0, y: 0.35, z: 0 };
/** Straight at the head. */
const STRAIGHT = { x: 0, y: 0, z: -3 };

test('alignment is 1 straight at the target and -1 straight away', () => {
  assert.ok(Math.abs(alignmentTo(STRAIGHT, FIST, HEAD)! - 1) < 1e-9);
  assert.ok(Math.abs(alignmentTo({ x: 0, y: 0, z: 3 }, FIST, HEAD)! + 1) < 1e-9);
  // Straight across is neither.
  assert.ok(Math.abs(alignmentTo({ x: 3, y: 0, z: 0 }, FIST, HEAD)!) < 1e-9);
});

test('alignment is null when there is no direction to speak of', () => {
  assert.equal(alignmentTo({ x: 0, y: 0, z: 0 }, FIST, HEAD), null);
  assert.equal(alignmentTo(STRAIGHT, HEAD, HEAD), null);
});

test('a straight punch in range lands', () => {
  const detector = new PunchDetector();
  const punch = detector.test(FIST, STRAIGHT, HEAD, HEAD_RADIUS, 0);

  assert.ok(punch);
  assert.ok(Math.abs(punch.speed - 3) < 1e-9);
  assert.ok(punch.alignment > 0.99);
});

test('a hook through the same space does not', () => {
  const detector = new PunchDetector();
  // Same speed, same place, travelling sideways.
  assert.equal(detector.test(FIST, { x: 3, y: 0, z: 0 }, HEAD, HEAD_RADIUS, 0), null);

  // And a punch just outside the alignment threshold misses too.
  const slop = Math.acos(MIN_ALIGNMENT) + 0.05;
  const angled = { x: Math.sin(slop) * 3, y: 0, z: -Math.cos(slop) * 3 };
  assert.equal(detector.test(FIST, angled, HEAD, HEAD_RADIUS, 0), null);
});

test('a slow hand reaching out does not punch', () => {
  const detector = new PunchDetector();
  assert.equal(
    detector.test(FIST, { x: 0, y: 0, z: -(MIN_PUNCH_SPEED - 0.05) }, HEAD, HEAD_RADIUS, 0),
    null,
  );
});

test('punching from out of reach hits nothing', () => {
  const detector = new PunchDetector();
  const far = { x: 0, y: 0.35, z: HEAD.z + HEAD_RADIUS + PUNCH_REACH + 0.1 };
  assert.equal(detector.test(far, STRAIGHT, HEAD, HEAD_RADIUS, 0), null);
});

test('one punch per cooldown, not one per frame', () => {
  const detector = new PunchDetector();
  assert.ok(detector.test(FIST, STRAIGHT, HEAD, HEAD_RADIUS, 0));

  for (let t = 16; t < PUNCH_COOLDOWN_MS; t += 16) {
    assert.equal(detector.test(FIST, STRAIGHT, HEAD, HEAD_RADIUS, t), null, `double-counted at ${t}`);
    assert.equal(detector.ready(t), false);
  }

  assert.ok(detector.ready(PUNCH_COOLDOWN_MS));
  assert.ok(detector.test(FIST, STRAIGHT, HEAD, HEAD_RADIUS, PUNCH_COOLDOWN_MS));
});

test('reset clears the cooldown', () => {
  const detector = new PunchDetector();
  detector.test(FIST, STRAIGHT, HEAD, HEAD_RADIUS, 0);
  detector.reset();
  assert.ok(detector.test(FIST, STRAIGHT, HEAD, HEAD_RADIUS, 10));
});

test('a faster, squarer punch hurts more', () => {
  const weak = punchDamage({ speed: MIN_PUNCH_SPEED, alignment: MIN_ALIGNMENT, distance: 0.1 });
  const fast = punchDamage({ speed: MIN_PUNCH_SPEED * 2, alignment: MIN_ALIGNMENT, distance: 0.1 });
  const square = punchDamage({ speed: MIN_PUNCH_SPEED, alignment: 1, distance: 0.1 });

  assert.ok(fast > weak, 'speed should matter');
  assert.ok(square > weak, 'squareness should matter');
  assert.ok(weak > 0, 'a legal punch should never do nothing');
});

test('damage is bounded, so one wild frame cannot end a round', () => {
  const absurd = punchDamage({ speed: 500, alignment: 1, distance: 0 });
  assert.ok(absurd <= 9 * 2, `a single punch did ${absurd}`);
});
