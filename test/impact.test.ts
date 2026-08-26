import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  MIN_STRIKE_SPEED,
  STRIKE_COOLDOWN_MS,
  StrikeDetector,
  Wobble,
} from '../src/interact/impact.js';
import type { Aabb } from '../src/interact/grab.js';

const DUMMY: Aabb = {
  id: 'dummy',
  min: { x: -0.12, y: 0.2, z: -0.12 },
  max: { x: 0.12, y: 0.9, z: 0.12 },
};

const CHEST = { x: 0, y: 0.6, z: 0 };
const FAST = { x: 0, y: 0, z: -3 };
const SLOW = { x: 0, y: 0, z: -0.3 };

test('a fast hand entering the target registers a strike', () => {
  const detector = new StrikeDetector();
  const strike = detector.test(DUMMY, CHEST, FAST, 0);

  assert.ok(strike);
  assert.ok(Math.abs(strike.speed - 3) < 1e-9);
  assert.deepEqual(strike.point, CHEST);
  // Direction is a unit vector along travel, for knocking the dummy back.
  assert.ok(Math.abs(Math.hypot(strike.direction.x, strike.direction.y, strike.direction.z) - 1) < 1e-9);
  assert.ok(strike.direction.z < 0);
});

test('resting a hand on the dummy is not a strike', () => {
  const detector = new StrikeDetector();
  assert.equal(detector.test(DUMMY, CHEST, SLOW, 0), null);
  assert.equal(detector.test(DUMMY, CHEST, { x: 0, y: 0, z: 0 }, 0), null);
});

test('the speed threshold is where it says it is', () => {
  const detector = new StrikeDetector();
  assert.equal(detector.test(DUMMY, CHEST, { x: MIN_STRIKE_SPEED - 0.01, y: 0, z: 0 }, 0), null);

  const fresh = new StrikeDetector();
  assert.ok(fresh.test(DUMMY, CHEST, { x: MIN_STRIKE_SPEED, y: 0, z: 0 }, 0));
});

test('a fast swing that misses does nothing', () => {
  const detector = new StrikeDetector();
  assert.equal(detector.test(DUMMY, { x: 0.9, y: 0.6, z: 0 }, FAST, 0), null);
  assert.equal(detector.test(DUMMY, { x: 0, y: 1.6, z: 0 }, FAST, 0), null);
});

test('one swing counts once, not sixty times a second', () => {
  const detector = new StrikeDetector();
  assert.ok(detector.test(DUMMY, CHEST, FAST, 0));

  // The rest of the same swing, still inside the box.
  for (let t = 16; t < STRIKE_COOLDOWN_MS; t += 16) {
    assert.equal(detector.test(DUMMY, CHEST, FAST, t), null, `double-counted at ${t}ms`);
  }

  assert.ok(detector.test(DUMMY, CHEST, FAST, STRIKE_COOLDOWN_MS + 1), 'cooldown never expired');
});

test('reset clears the cooldown', () => {
  const detector = new StrikeDetector();
  detector.test(DUMMY, CHEST, FAST, 0);
  detector.reset();
  assert.ok(detector.test(DUMMY, CHEST, FAST, 10));
});

test('an untouched dummy stands still', () => {
  const wobble = new Wobble();
  assert.ok(wobble.atRest);
  for (let i = 0; i < 60; i += 1) wobble.step(1 / 60);
  assert.ok(wobble.atRest);
  assert.deepEqual(wobble.lean, { x: 0, z: 0 });
});

test('a hit rocks the dummy and it settles back upright', () => {
  const wobble = new Wobble();
  wobble.impulse(0, -1, 3);

  let peak = 0;
  for (let i = 0; i < 30; i += 1) {
    wobble.step(1 / 60);
    peak = Math.max(peak, Math.abs(wobble.lean.z));
  }
  assert.ok(peak > 0.02, `barely moved, peak lean ${peak}`);

  for (let i = 0; i < 400; i += 1) wobble.step(1 / 60);
  assert.ok(wobble.atRest, `still swinging at lean ${JSON.stringify(wobble.lean)}`);
});

test('it overshoots on the way back, which is what sells the hit', () => {
  const wobble = new Wobble();
  wobble.impulse(0, -1, 3);

  let crossedBack = false;
  let wentNegative = false;
  for (let i = 0; i < 200; i += 1) {
    wobble.step(1 / 60);
    if (wobble.lean.z < -0.01) wentNegative = true;
    if (wentNegative && wobble.lean.z > 0.005) crossedBack = true;
  }
  assert.ok(crossedBack, 'no overshoot — the dummy would look dead');
});

test('a harder hit leans further', () => {
  const soft = new Wobble();
  const hard = new Wobble();
  soft.impulse(1, 0, 1.5);
  hard.impulse(1, 0, 4);

  let softPeak = 0;
  let hardPeak = 0;
  for (let i = 0; i < 40; i += 1) {
    soft.step(1 / 60);
    hard.step(1 / 60);
    softPeak = Math.max(softPeak, Math.abs(soft.lean.x));
    hardPeak = Math.max(hardPeak, Math.abs(hard.lean.x));
  }
  assert.ok(hardPeak > softPeak);
});

test('lean is clamped, so a huge hit does not fold the dummy in half', () => {
  const wobble = new Wobble();
  wobble.impulse(1, 1, 500);
  for (let i = 0; i < 30; i += 1) wobble.step(1 / 60);
  assert.ok(Math.abs(wobble.lean.x) <= 0.42 + 1e-9);
  assert.ok(Math.abs(wobble.lean.z) <= 0.42 + 1e-9);
});

test('a stalled frame does not blow the spring up', () => {
  const wobble = new Wobble();
  wobble.impulse(1, 0, 3);
  wobble.step(5);
  assert.ok(Number.isFinite(wobble.lean.x) && Math.abs(wobble.lean.x) <= 0.42 + 1e-9);

  wobble.step(0);
  wobble.step(-1);
  assert.ok(Number.isFinite(wobble.lean.x));
});
