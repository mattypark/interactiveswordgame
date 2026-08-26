/**
 * One Euro's whole reason for being here is that it must smooth a still hand
 * hard while barely lagging a fast one. These tests pin both halves of that
 * claim, plus the guards that keep bad timestamps from corrupting state.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { OneEuroFilter, Vec3Filter } from '../src/hands/filter.js';

const HZ = 60;
const DT = 1 / HZ;

/** Deterministic pseudo-noise — a fixed seed keeps the test from flaking. */
function noise(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296 - 0.5;
  };
}

test('a constant signal settles on its value', () => {
  const filter = new OneEuroFilter();
  let out = 0;
  for (let i = 0; i < 120; i += 1) out = filter.filter(5, i * DT);
  assert.ok(Math.abs(out - 5) < 1e-3, `settled at ${out}`);
});

test('the first sample passes straight through', () => {
  const filter = new OneEuroFilter();
  assert.equal(filter.filter(0.42, 0), 0.42);
});

test('a step is followed, not ignored', () => {
  const filter = new OneEuroFilter();
  for (let i = 0; i < 60; i += 1) filter.filter(0, i * DT);

  let out = 0;
  for (let i = 60; i < 240; i += 1) out = filter.filter(1, i * DT);
  assert.ok(out > 0.99, `step only reached ${out}`);
});

test('jitter on a still hand is cut hard', () => {
  const random = noise(7);
  const filter = new OneEuroFilter();

  let rawError = 0;
  let filteredError = 0;
  for (let i = 0; i < 300; i += 1) {
    const sample = 0.5 + random() * 0.02;
    const out = filter.filter(sample, i * DT);
    if (i > 60) {
      rawError += Math.abs(sample - 0.5);
      filteredError += Math.abs(out - 0.5);
    }
  }

  assert.ok(
    filteredError < rawError * 0.5,
    `filtered error ${filteredError.toFixed(4)} vs raw ${rawError.toFixed(4)}`,
  );
});

test('beta buys back lag on fast motion', () => {
  // Same fast ramp through two filters: one adaptive, one a plain low-pass.
  const adaptive = new OneEuroFilter({ minCutoff: 1.4, beta: 0.05 });
  const fixed = new OneEuroFilter({ minCutoff: 1.4, beta: 0 });

  let adaptiveOut = 0;
  let fixedOut = 0;
  for (let i = 0; i < 60; i += 1) {
    const value = i * 0.05; // ~3 units/second
    adaptiveOut = adaptive.filter(value, i * DT);
    fixedOut = fixed.filter(value, i * DT);
  }

  const truth = 59 * 0.05;
  assert.ok(
    Math.abs(truth - adaptiveOut) < Math.abs(truth - fixedOut),
    `adaptive lag ${(truth - adaptiveOut).toFixed(4)} should beat fixed ${(truth - fixedOut).toFixed(4)}`,
  );
});

test('duplicate or backwards timestamps hold the last value', () => {
  const filter = new OneEuroFilter();
  filter.filter(1, 0);
  const settled = filter.filter(2, DT);

  assert.equal(filter.filter(99, DT), settled, 'duplicate timestamp changed the output');
  assert.equal(filter.filter(99, 0), settled, 'backwards timestamp changed the output');
});

test('reset returns the filter to first-sample behaviour', () => {
  const filter = new OneEuroFilter();
  for (let i = 0; i < 60; i += 1) filter.filter(10, i * DT);

  filter.reset();
  assert.equal(filter.filter(-3, 0), -3);
});

test('Vec3Filter smooths each axis independently', () => {
  const filter = new Vec3Filter();
  let out = filter.filter(1, 2, 3, 0);
  assert.deepEqual(out, { x: 1, y: 2, z: 3 });

  for (let i = 1; i < 200; i += 1) out = filter.filter(0, 5, -2, i * DT);
  assert.ok(Math.abs(out.x - 0) < 1e-3);
  assert.ok(Math.abs(out.y - 5) < 1e-3);
  assert.ok(Math.abs(out.z - -2) < 1e-3);
});
