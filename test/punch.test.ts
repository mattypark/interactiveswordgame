import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ACTIVE_MS,
  BLOCKED_COOLDOWN_MS,
  CHAIN_COOLDOWN_MS,
  MIN_ALIGNMENT,
  MIN_PUNCH_SPEED,
  PUNCH_COOLDOWN_MS,
  PUNCH_REACH,
  PunchDetector,
  alignmentTo,
  distanceToSegment,
  punchDamage,
  sweptDistance,
  type Swing,
} from '../src/game/punch.js';
import type { Vec3 } from '../src/hands/project.js';

const HEAD: Vec3 = { x: 0, y: 0.35, z: -0.3 };
const HEAD_RADIUS = 0.095;
const STRAIGHT: Vec3 = { x: 0, y: 0, z: -3 };

/** Four knuckles in a line across the hand, centred on `at`. */
function knuckles(at: Vec3): Vec3[] {
  return [-0.03, -0.01, 0.01, 0.03].map((offset) => ({
    x: at.x + offset,
    y: at.y,
    z: at.z,
  }));
}

function swing(at: Vec3, from: Vec3 | null = null, velocity: Vec3 = STRAIGHT): Swing {
  return {
    points: knuckles(at),
    previous: from ? knuckles(from) : null,
    velocity,
    peakSpeed: Math.hypot(velocity.x, velocity.y, velocity.z),
  };
}

const NEAR: Vec3 = { x: 0, y: 0.35, z: -0.16 };
const FAR: Vec3 = { x: 0, y: 0.35, z: 0.2 };

test('alignment is 1 straight at the target and -1 straight away', () => {
  assert.ok(Math.abs(alignmentTo(STRAIGHT, FAR, HEAD)! - 1) < 1e-9);
  assert.ok(Math.abs(alignmentTo({ x: 0, y: 0, z: 3 }, FAR, HEAD)! + 1) < 1e-9);
  assert.ok(Math.abs(alignmentTo({ x: 3, y: 0, z: 0 }, FAR, HEAD)!) < 1e-9);
});

test('alignment is null when there is no direction to speak of', () => {
  assert.equal(alignmentTo({ x: 0, y: 0, z: 0 }, FAR, HEAD), null);
  assert.equal(alignmentTo(STRAIGHT, HEAD, HEAD), null);
});

test('the segment distance is the closest approach, not the endpoint', () => {
  const a = { x: -1, y: 0, z: 0 };
  const b = { x: 1, y: 0, z: 0 };
  assert.ok(Math.abs(distanceToSegment(a, b, { x: 0, y: 0.5, z: 0 }) - 0.5) < 1e-9);
  assert.ok(Math.abs(distanceToSegment(a, b, { x: 3, y: 0, z: 0 }) - 2) < 1e-9);
  assert.ok(Math.abs(distanceToSegment(a, a, { x: -1, y: 1, z: 0 }) - 1) < 1e-9);
});

test('the swept test reports whichever knuckle came closest', () => {
  // Target offset to one side: the knuckle on that side should win.
  const offTarget = { x: 0.03, y: 0.35, z: -0.3 };
  const contact = sweptDistance(knuckles(NEAR), null, offTarget);
  assert.ok(contact);
  assert.equal(contact.pointIndex, 3, 'picked the wrong knuckle');
  assert.ok(contact.distance < 0.15);

  assert.equal(sweptDistance([], null, HEAD), null);
});

test('a straight punch in range lands', () => {
  const detector = new PunchDetector();
  const punch = detector.test(swing(NEAR, FAR), HEAD, HEAD_RADIUS, 0);

  assert.ok(punch);
  assert.ok(punch.speed >= MIN_PUNCH_SPEED);
  assert.ok(punch.alignment > 0.99);
});

test('a hook through the same space does not', () => {
  const detector = new PunchDetector();
  assert.equal(
    detector.test(swing(NEAR, FAR, { x: 3, y: 0, z: 0 }), HEAD, HEAD_RADIUS, 0),
    null,
  );

  const slop = Math.acos(MIN_ALIGNMENT) + 0.08;
  const angled = { x: Math.sin(slop) * 3, y: 0, z: -Math.cos(slop) * 3 };
  const fresh = new PunchDetector();
  assert.equal(fresh.test(swing(NEAR, FAR, angled), HEAD, HEAD_RADIUS, 0), null);
});

test('a slow hand reaching out does not punch', () => {
  const detector = new PunchDetector();
  const crawl = { x: 0, y: 0, z: -(MIN_PUNCH_SPEED - 0.2) };
  assert.equal(detector.test(swing(NEAR, FAR, crawl), HEAD, HEAD_RADIUS, 0), null);
});

test('punching from out of reach hits nothing', () => {
  const detector = new PunchDetector();
  const short = { x: 0, y: 0.35, z: HEAD.z + HEAD_RADIUS + PUNCH_REACH + 0.2 };
  assert.equal(detector.test(swing(short, { ...short, z: short.z + 0.1 }), HEAD, HEAD_RADIUS, 0), null);
});

test('a knuckle on target lands even when the palm centre is off', () => {
  // The whole reason for a multi-point hitbox: a punch that is a few
  // centimetres wide at the middle of the hand is still a punch.
  const detector = new PunchDetector();
  const offset = { x: 0.085, y: 0.35, z: -0.16 };
  const before = { x: 0.085, y: 0.35, z: 0.2 };

  const punch = detector.test(swing(offset, before), HEAD, HEAD_RADIUS, 0);
  assert.ok(punch, 'a punch that grazed with the knuckles was thrown away');
  assert.equal(punch.pointIndex, 0, 'should have connected with the near knuckle');
});

test('a fast punch that sweeps clean through still lands', () => {
  // At 30fps a fast fist covers 10cm between frames; testing only where it
  // ended up lets it pass straight through and register nothing.
  const past = { x: 0, y: 0.35, z: -0.6 };
  const before = { x: 0, y: 0.35, z: 0 };

  const unswept = new PunchDetector();
  assert.equal(
    unswept.test({ ...swing(past), previous: null }, HEAD, HEAD_RADIUS, 0),
    null,
    'this fixture should miss without the sweep, or the test proves nothing',
  );

  const swept = new PunchDetector();
  assert.ok(swept.test(swing(past, before), HEAD, HEAD_RADIUS, 0));
});

test('a sweep that goes wide still misses', () => {
  const detector = new PunchDetector();
  const past = { x: 0.9, y: 0.35, z: -0.6 };
  const before = { x: 0.9, y: 0.35, z: 0 };
  assert.equal(detector.test(swing(past, before), HEAD, HEAD_RADIUS, 0), null);
});

test('an armed swing stays live for its active window', () => {
  // Arming and connecting are separate: at 30fps the frame a swing commits on
  // is often not the frame it touches.
  const detector = new PunchDetector();

  // Commit while still short of the head — fast and aimed, but no contact.
  assert.equal(detector.test(swing(FAR, { x: 0, y: 0.35, z: 0.4 }), HEAD, HEAD_RADIUS, 0), null);
  assert.ok(detector.active(0), 'the swing never armed');

  // Contact a couple of frames later, with the hand now barely moving.
  const drift = { x: 0, y: 0, z: -0.05 };
  const punch = detector.test(swing(NEAR, FAR, drift), HEAD, HEAD_RADIUS, 60);
  assert.ok(punch, 'contact inside the active window was ignored');
  assert.ok(punch.speed >= MIN_PUNCH_SPEED, 'scored on the drift instead of the swing');
});

test('the active window closes, so a stale swing does not land later', () => {
  const detector = new PunchDetector();
  detector.test(swing(FAR, { x: 0, y: 0.35, z: 0.4 }), HEAD, HEAD_RADIUS, 0);
  assert.equal(detector.active(ACTIVE_MS + 1), false);

  const drift = { x: 0, y: 0, z: -0.05 };
  assert.equal(detector.test(swing(NEAR, FAR, drift), HEAD, HEAD_RADIUS, ACTIVE_MS + 20), null);
});

test('one punch per cooldown, not one per frame', () => {
  const detector = new PunchDetector();
  assert.ok(detector.test(swing(NEAR, FAR), HEAD, HEAD_RADIUS, 0));

  for (let t = 16; t < PUNCH_COOLDOWN_MS; t += 16) {
    assert.equal(detector.test(swing(NEAR, FAR), HEAD, HEAD_RADIUS, t), null, `double-counted at ${t}`);
  }
  assert.ok(detector.test(swing(NEAR, FAR), HEAD, HEAD_RADIUS, PUNCH_COOLDOWN_MS));
});

test('landing one lets you chain sooner; being blocked makes you wait', () => {
  const chaining = new PunchDetector();
  chaining.test(swing(NEAR, FAR), HEAD, HEAD_RADIUS, 0);
  chaining.resolve('landed');
  assert.ok(chaining.ready(CHAIN_COOLDOWN_MS), 'a landed punch did not open a chain window');
  assert.equal(chaining.ready(CHAIN_COOLDOWN_MS - 20), false);

  const blocked = new PunchDetector();
  blocked.test(swing(NEAR, FAR), HEAD, HEAD_RADIUS, 0);
  blocked.resolve('blocked');
  assert.equal(blocked.ready(PUNCH_COOLDOWN_MS), false, 'no cost to swinging into a guard');
  assert.ok(blocked.ready(BLOCKED_COOLDOWN_MS));
});

test('reset clears the cooldown and any armed swing', () => {
  const detector = new PunchDetector();
  detector.test(swing(NEAR, FAR), HEAD, HEAD_RADIUS, 0);
  detector.reset();
  assert.equal(detector.active(10), false);
  assert.ok(detector.test(swing(NEAR, FAR), HEAD, HEAD_RADIUS, 10));
});

test('a faster, squarer punch hurts more', () => {
  const base = { distance: 0.05, pointIndex: 0 };
  const weak = punchDamage({ ...base, speed: MIN_PUNCH_SPEED, alignment: MIN_ALIGNMENT });
  const fast = punchDamage({ ...base, speed: MIN_PUNCH_SPEED * 2, alignment: MIN_ALIGNMENT });
  const square = punchDamage({ ...base, speed: MIN_PUNCH_SPEED, alignment: 1 });

  assert.ok(fast > weak);
  assert.ok(square > weak);
  assert.ok(weak > 0, 'a legal punch should never do nothing');
});

test('damage is bounded, so one wild frame cannot end a round', () => {
  const absurd = punchDamage({ speed: 500, alignment: 1, distance: 0, pointIndex: 0 });
  assert.ok(absurd <= 11 * 2, `a single punch did ${absurd}`);
});
