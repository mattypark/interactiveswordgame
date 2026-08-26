import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CalibrationSampler,
  DEFAULT_CALIBRATION,
  MIN_CALIBRATION_SPREAD,
  REQUIRED_SAMPLES,
  curlRatio,
  isUsableCalibration,
  normaliseGrip,
} from '../src/hands/grip.js';
import { FIST_HAND, OPEN_HAND, scaleHand } from './fixtures.js';

test('an open hand reaches further than a fist', () => {
  const open = curlRatio(OPEN_HAND);
  const fist = curlRatio(FIST_HAND);
  assert.ok(open !== null && fist !== null);
  assert.ok(open > fist, `open ${open} should exceed fist ${fist}`);
  // The gap has to be wide enough for the default calibration to resolve it.
  assert.ok(open - fist > MIN_CALIBRATION_SPREAD);
});

test('the default calibration brackets a real hand', () => {
  const open = curlRatio(OPEN_HAND)!;
  const fist = curlRatio(FIST_HAND)!;
  assert.ok(
    open <= DEFAULT_CALIBRATION.openRatio + 0.35 && open >= DEFAULT_CALIBRATION.openRatio - 0.35,
    `open hand measured ${open.toFixed(2)}, default expects ~${DEFAULT_CALIBRATION.openRatio}`,
  );
  assert.ok(
    fist <= DEFAULT_CALIBRATION.fistRatio + 0.35,
    `fist measured ${fist.toFixed(2)}, default expects ~${DEFAULT_CALIBRATION.fistRatio}`,
  );
});

test('curl is scale-free, so hand size does not change it', () => {
  const normal = curlRatio(OPEN_HAND)!;
  const small = curlRatio(scaleHand(OPEN_HAND, 0.72))!;
  const large = curlRatio(scaleHand(OPEN_HAND, 1.4))!;
  assert.ok(Math.abs(normal - small) < 1e-9);
  assert.ok(Math.abs(normal - large) < 1e-9);
});

test('curl refuses landmarks it cannot measure', () => {
  assert.equal(curlRatio([]), null);
  // Wrist and MCP on top of each other: no palm to measure against.
  const collapsed = OPEN_HAND.map(() => ({ x: 0, y: 0, z: 0 }));
  assert.equal(curlRatio(collapsed), null);
  assert.equal(curlRatio(OPEN_HAND.slice(0, 10)), null);
});

test('grip normalises open to 0 and closed to 1', () => {
  const calibration = { openRatio: 1.9, fistRatio: 1.0 };
  assert.equal(normaliseGrip(1.9, calibration), 0);
  assert.equal(normaliseGrip(1.0, calibration), 1);
  assert.ok(Math.abs(normaliseGrip(1.45, calibration) - 0.5) < 1e-9);
});

test('grip clamps beyond the calibrated range', () => {
  const calibration = { openRatio: 1.9, fistRatio: 1.0 };
  assert.equal(normaliseGrip(2.6, calibration), 0, 'hyperextended fingers should not go negative');
  assert.equal(normaliseGrip(0.2, calibration), 1, 'over-squeezing should not exceed 1');
});

test('an inverted or collapsed calibration reads as no grip, not NaN', () => {
  assert.equal(normaliseGrip(1.4, { openRatio: 1.0, fistRatio: 1.9 }), 0);
  assert.equal(normaliseGrip(1.4, { openRatio: 1.5, fistRatio: 1.5 }), 0);
});

test('calibration is rejected unless open and closed are far apart', () => {
  assert.ok(isUsableCalibration({ openRatio: 1.9, fistRatio: 1.0 }));
  assert.ok(!isUsableCalibration({ openRatio: 1.4, fistRatio: 1.3 }));
  assert.ok(!isUsableCalibration({ openRatio: 1.0, fistRatio: 1.9 }));
});

test('the sampler waits for enough frames before committing', () => {
  const sampler = new CalibrationSampler();
  sampler.begin('rest');
  assert.ok(sampler.active);

  for (let i = 0; i < REQUIRED_SAMPLES - 1; i += 1) {
    assert.equal(sampler.push(1.8), null, `committed early at sample ${i}`);
  }

  const outcome = sampler.push(1.8);
  assert.ok(outcome?.ok);
  assert.ok(Math.abs(outcome.ratio! - 1.8) < 1e-9);
  assert.equal(sampler.active, false, 'sampler should reset itself after committing');
});

test('the sampler shrugs off a single wild frame', () => {
  const sampler = new CalibrationSampler();
  sampler.begin('max');

  let outcome = null;
  for (let i = 0; i < REQUIRED_SAMPLES; i += 1) {
    // One frame where the model loses a finger and reports nonsense.
    outcome = sampler.push(i === 3 ? 42 : 1.05);
  }

  assert.ok(outcome?.ok);
  assert.ok(
    Math.abs(outcome.ratio! - 1.05) < 1e-9,
    `median moved to ${outcome.ratio} because of one outlier`,
  );
});

test('frames with no hand do not count toward the sample budget', () => {
  const sampler = new CalibrationSampler();
  sampler.begin('rest');

  for (let i = 0; i < 50; i += 1) assert.equal(sampler.push(null), null);
  assert.ok(sampler.active, 'sampler gave up while waiting for a hand');
  assert.equal(sampler.progress, 0);

  let outcome = null;
  for (let i = 0; i < REQUIRED_SAMPLES; i += 1) outcome = sampler.push(1.7);
  assert.ok(outcome?.ok);
});

test('pushing without starting does nothing, and cancel abandons progress', () => {
  const sampler = new CalibrationSampler();
  assert.equal(sampler.push(1.5), null);

  sampler.begin('rest');
  sampler.push(1.5);
  sampler.cancel();
  assert.equal(sampler.active, false);
  assert.equal(sampler.progress, 0);
});
