import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  HOLD_MS,
  MIN_SAMPLES,
  STILL_SPREAD,
  SetupFlow,
  TIMEOUT_MS,
  type SetupFrame,
} from '../src/hud/setup.js';

const STEP_MS = 33; // ~30fps, what the camera actually delivers

function frame(now: number, overrides: Partial<SetupFrame> = {}): SetupFrame {
  return {
    present: true,
    raw: { x: 0.42, y: 0.58 },
    depth: 0.37,
    curls: [1.85],
    position: { x: 0, y: 0.32, z: 0 },
    now,
    ...overrides,
  };
}

/** Feed `ms` of frames, calling `shape` to vary each one. */
function feed(
  flow: SetupFlow,
  ms: number,
  start = 0,
  shape: (t: number) => Partial<SetupFrame> = () => ({}),
): number {
  let t = start;
  for (; t < start + ms; t += STEP_MS) flow.update(frame(t, shape(t)));
  return t;
}

test('it does nothing until started', () => {
  const flow = new SetupFlow();
  assert.equal(flow.step, 'idle');
  feed(flow, 5000);
  assert.equal(flow.step, 'idle');
  assert.equal(flow.result, null);
});

test('a steady hand completes both steps', () => {
  const flow = new SetupFlow();
  flow.start(0);

  let t = feed(flow, HOLD_MS + 200, 0);
  assert.equal(flow.step, 'squeeze', 'never got past the centre step');

  feed(flow, HOLD_MS + 200, t, () => ({ curls: [1.05] }));
  assert.equal(flow.step, 'done');

  const result = flow.take();
  assert.ok(result);
  assert.ok(Math.abs(result.origin.y - 0.58) < 1e-9);
  assert.ok(Math.abs(result.calibration.openRatio - 1.85) < 1e-9);
  assert.ok(Math.abs(result.calibration.fistRatio - 1.05) < 1e-9);
  assert.equal(flow.take(), null, 'take() should be one-shot');
});

test('one jittery frame does not throw away the whole capture', () => {
  // This is the bug the rewrite exists for: a consecutive-frame counter is
  // reset by any single spike and can hang forever.
  const flow = new SetupFlow();
  flow.start(0);

  let t = 0;
  for (let i = 0; i < 60; i += 1) {
    // A 12cm spike every eighth frame, otherwise dead still.
    const spike = i % 8 === 0 ? 0.12 : 0;
    flow.update(frame(t, { position: { x: spike, y: 0.32, z: 0 } }));
    t += STEP_MS;
  }

  assert.notEqual(flow.step, 'centre', 'never committed despite mostly holding still');
});

test('a hand genuinely being waved about does not commit', () => {
  const flow = new SetupFlow();
  flow.start(0);

  // Well beyond the allowed wander, and kept up past the hold time.
  feed(flow, HOLD_MS * 3, 0, (t) => ({
    position: { x: Math.sin(t / 60) * 0.35, y: 0.32, z: 0 },
  }));

  assert.equal(flow.step, 'centre');
  assert.ok(flow.steadiness < 0.4, `steadiness read ${flow.steadiness}`);
});

test('progress eases back under wobble instead of snapping to zero', () => {
  const flow = new SetupFlow();
  flow.start(0);

  let t = feed(flow, HOLD_MS * 0.6, 0);
  const settled = flow.progress;
  assert.ok(settled > 0.2, `progress only reached ${settled}`);

  // A wobble: progress should drop but not vanish.
  t = feed(flow, 120, t, () => ({ position: { x: 0.09, y: 0.32, z: 0 } }));
  assert.ok(flow.progress < settled, 'wobble did not register at all');
  assert.ok(flow.progress > 0, 'progress reset to nothing on a wobble');
});

test('it gives up waiting for perfect stillness rather than hanging', () => {
  const flow = new SetupFlow();
  flow.start(0);

  // Permanently just outside the still threshold — a shaky hand, or a camera
  // that never quite settles. It must still finish the step.
  feed(flow, TIMEOUT_MS + 500, 0, (t) => ({
    position: { x: Math.sin(t / 90) * (STILL_SPREAD * 1.6), y: 0.32, z: 0 },
  }));

  assert.notEqual(flow.step, 'centre', 'hung forever waiting to be held perfectly still');
});

test('a brief dropout is survived; a real absence is not', () => {
  const flow = new SetupFlow();
  flow.start(0);

  let t = feed(flow, HOLD_MS * 0.7, 0);
  const before = flow.progress;

  // Lost for a few frames, as happens constantly.
  t = feed(flow, 120, t, () => ({ present: false }));
  assert.ok(flow.progress > 0, 'a two-frame dropout wiped the capture');
  assert.ok(before > 0);

  // Gone properly.
  feed(flow, 2500, t, () => ({ present: false }));
  assert.equal(flow.progress, 0);
  assert.match(flow.prompt, /show your hand/i);
});

test('one unmeasurable frame does not skew the capture', () => {
  const flow = new SetupFlow();
  flow.start(0);

  // Just enough frames to finish the centre step, with one wild reading in it.
  let t = 0;
  let i = 0;
  while (flow.step === 'centre') {
    flow.update(frame(t, { curls: [i === 3 ? 42 : 1.88] }));
    t += STEP_MS;
    i += 1;
  }
  feed(flow, HOLD_MS + 200, t, () => ({ curls: [1.03] }));

  const result = flow.take();
  assert.ok(result);
  assert.ok(
    Math.abs(result.calibration.openRatio - 1.88) < 1e-9,
    `outlier moved the open ratio to ${result.calibration.openRatio}`,
  );
});

test('a fist that reads like an open hand is rejected, and can be retried', () => {
  const flow = new SetupFlow();
  flow.start(0);

  let t = feed(flow, HOLD_MS + 200, 0);
  assert.equal(flow.step, 'squeeze');

  t = feed(flow, HOLD_MS + 200, t, () => ({ curls: [1.78] }));
  assert.equal(flow.step, 'squeeze', 'accepted a useless calibration');
  assert.equal(flow.result, null);
  assert.match(flow.prompt, /squeeze tighter/i);

  feed(flow, HOLD_MS + 200, t, () => ({ curls: [1.02] }));
  assert.equal(flow.step, 'done');
  assert.ok(flow.take());
});

test('a hand that was not really open is refused at capture, not later', () => {
  // The trap this exists for: storing a half-closed hand as "open" makes the
  // squeeze step impossible to pass, with no way back to fix it.
  const flow = new SetupFlow();
  flow.start(0);

  feed(flow, HOLD_MS + 300, 0, () => ({ curls: [1.15] }));
  assert.equal(flow.step, 'centre', 'stored a closed hand as the open reading');
  assert.match(flow.prompt, /open your hand wider/i);
  assert.equal(flow.capturedOpen, null);
});

test('a hand that always reads narrow is eventually accepted anyway', () => {
  // Otherwise the floor just moves the dead end from the squeeze step to here.
  const flow = new SetupFlow();
  flow.start(0);

  // Step frame by frame and stop the instant it moves on, so the narrow
  // reading isn't also fed into the squeeze step.
  let t = 0;
  for (let i = 0; i < 2000 && flow.step === 'centre'; i += 1) {
    flow.update(frame(t, { curls: [1.2] }));
    t += STEP_MS;
  }

  assert.equal(flow.step, 'squeeze', 'refused a narrow hand forever');
  assert.ok(flow.capturedOpen !== null);
  assert.match(flow.prompt, /fist/i);
});

test('repeated squeeze failures send you back to redo the open pose', () => {
  const flow = new SetupFlow();
  flow.start(0);

  // Barely-open hand that still clears the floor, so "open" is stored low.
  let t = feed(flow, HOLD_MS + 200, 0, () => ({ curls: [1.4] }));
  assert.equal(flow.step, 'squeeze');

  // Two fists that can't be far enough below it.
  t = feed(flow, HOLD_MS + 200, t, () => ({ curls: [1.25] }));
  assert.equal(flow.step, 'squeeze');
  t = feed(flow, HOLD_MS + 200, t, () => ({ curls: [1.25] }));

  assert.equal(flow.step, 'centre', 'stayed stuck asking for a tighter fist forever');
  assert.match(flow.prompt, /try again/i);
  assert.equal(flow.capturedOpen, null);
});

test('with both hands up it reads whichever one is actually posed', () => {
  const flow = new SetupFlow();
  flow.start(0);

  // One hand open, the other resting closed: "open" should take the open one.
  let t = feed(flow, HOLD_MS + 200, 0, () => ({ curls: [1.05, 1.9] }));
  assert.equal(flow.step, 'squeeze', 'the closed hand blocked the open capture');

  // Then one fist and one still open: "squeeze" should take the fist.
  feed(flow, HOLD_MS + 200, t, () => ({ curls: [1.9, 1.02] }));
  assert.equal(flow.step, 'done');

  const result = flow.take();
  assert.ok(result);
  assert.ok(Math.abs(result.calibration.openRatio - 1.9) < 1e-9);
  assert.ok(Math.abs(result.calibration.fistRatio - 1.02) < 1e-9);
});

test('the live reading follows the step being asked for', () => {
  const flow = new SetupFlow();
  flow.start(0);

  flow.update(frame(0, { curls: [1.05, 1.9] }));
  assert.equal(flow.liveCurl, 1.9, 'open step should show the most open hand');

  const t = feed(flow, HOLD_MS + 200, 0, () => ({ curls: [1.05, 1.9] }));
  flow.update(frame(t, { curls: [1.9, 1.02] }));
  assert.equal(flow.liveCurl, 1.02, 'squeeze step should show the most closed hand');
});

test('capture now commits early once there is something to commit', () => {
  const flow = new SetupFlow();
  flow.start(0);

  assert.equal(flow.captureNow(), false, 'committed with no readings at all');

  feed(flow, STEP_MS * MIN_SAMPLES + STEP_MS, 0);
  assert.ok(flow.captureNow());
  assert.equal(flow.step, 'squeeze');
});

test('cancel returns it to idle and stops it committing', () => {
  const flow = new SetupFlow();
  flow.start(0);
  feed(flow, HOLD_MS * 0.5, 0);

  flow.cancel();
  assert.equal(flow.step, 'idle');
  assert.equal(flow.progress, 0);
  assert.equal(flow.captureNow(), false);

  feed(flow, 5000, 5000);
  assert.equal(flow.result, null);
});

test('the prompt always says what to do next', () => {
  const flow = new SetupFlow();
  flow.start(0);
  assert.match(flow.prompt, /open/i);

  const t = feed(flow, HOLD_MS + 200, 0);
  assert.match(flow.prompt, /fist/i);

  feed(flow, HOLD_MS + 200, t, () => ({ curls: [1.02] }));
  assert.match(flow.prompt, /set/i);
});
