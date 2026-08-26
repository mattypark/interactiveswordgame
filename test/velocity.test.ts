import assert from 'node:assert/strict';
import { test } from 'node:test';

import { VelocityTracker, WINDOW_MS } from '../src/hands/velocity.js';

test('a hand that has not moved has no velocity', () => {
  const tracker = new VelocityTracker();
  for (let i = 0; i < 10; i += 1) tracker.push({ x: 0.1, y: 0.2, z: 0.3 }, i * 16);
  assert.equal(tracker.speed, 0);
});

test('velocity matches a steady sweep', () => {
  const tracker = new VelocityTracker();
  // 2 m/s along x, sampled at 60fps.
  for (let i = 0; i < 20; i += 1) tracker.push({ x: i * (2 / 60), y: 0, z: 0 }, i * (1000 / 60));

  const v = tracker.velocity();
  assert.ok(Math.abs(v.x - 2) < 0.05, `measured ${v.x} m/s`);
  assert.ok(Math.abs(v.y) < 1e-9);
});

test('an empty or single-sample tracker reports zero rather than NaN', () => {
  const tracker = new VelocityTracker();
  assert.deepEqual(tracker.velocity(), { x: 0, y: 0, z: 0 });

  tracker.push({ x: 1, y: 1, z: 1 }, 0);
  const v = tracker.velocity();
  assert.ok(Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z));
  assert.equal(tracker.speed, 0);
});

test('the window ignores motion older than it', () => {
  const tracker = new VelocityTracker();

  // A long, slow drift...
  for (let i = 0; i < 40; i += 1) tracker.push({ x: i * 0.001, y: 0, z: 0 }, i * 16);
  const slow = tracker.speed;

  // ...then a sudden flick inside the window.
  const base = 40 * 16;
  for (let i = 0; i < 6; i += 1) tracker.push({ x: 0.04 + i * 0.03, y: 0, z: 0 }, base + i * 16);

  assert.ok(tracker.speed > slow * 5, 'the recent flick should dominate the old drift');
});

test('the release velocity comes from the throw, not the last two frames', () => {
  const tracker = new VelocityTracker();

  // A fast sweep that stalls right at the end — what a hand does as the
  // fingers open. A two-frame difference here would read as nearly zero.
  let x = 0;
  let time = 0;
  for (let i = 0; i < 8; i += 1) {
    tracker.push({ x, y: 0, z: 0 }, time);
    x += 0.05;
    time += 16;
  }
  // Two near-identical frames at the moment of release.
  tracker.push({ x, y: 0, z: 0 }, time);
  tracker.push({ x: x + 0.0005, y: 0, z: 0 }, time + 16);

  assert.ok(tracker.speed > 1, `stalled to ${tracker.speed.toFixed(2)} m/s at release`);
});

test('the window is bounded, so a long session does not grow memory', () => {
  const tracker = new VelocityTracker();
  for (let i = 0; i < 5000; i += 1) tracker.push({ x: i * 0.001, y: 0, z: 0 }, i * 16);
  // Nothing to assert on internals; the guarantee is it still answers sanely.
  assert.ok(Number.isFinite(tracker.speed));
  assert.ok(WINDOW_MS > 0);
});

test('reset clears the history', () => {
  const tracker = new VelocityTracker();
  for (let i = 0; i < 10; i += 1) tracker.push({ x: i * 0.05, y: 0, z: 0 }, i * 16);
  assert.ok(tracker.speed > 0);

  tracker.reset();
  assert.equal(tracker.speed, 0);
});
