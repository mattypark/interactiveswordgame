import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SetupFlow, STILL_FRAMES, STILL_SPEED } from '../src/hud/setup.js';
import type { SetupFrame } from '../src/hud/setup.js';

function frame(overrides: Partial<SetupFrame> = {}): SetupFrame {
  return {
    present: true,
    raw: { x: 0.42, y: 0.58 },
    depth: 0.37,
    curl: 1.85,
    speed: 0,
    ...overrides,
  };
}

/** Feed `count` identical frames. */
function feed(flow: SetupFlow, count: number, overrides: Partial<SetupFrame> = {}): void {
  for (let i = 0; i < count; i += 1) flow.update(frame(overrides));
}

test('it does nothing until started', () => {
  const flow = new SetupFlow();
  assert.equal(flow.step, 'idle');
  assert.equal(flow.running, false);

  feed(flow, 100);
  assert.equal(flow.step, 'idle');
  assert.equal(flow.result, null);
});

test('a full run captures the centre and both grip ends', () => {
  const flow = new SetupFlow();
  flow.start();
  assert.equal(flow.step, 'centre');

  feed(flow, STILL_FRAMES, { curl: 1.9 });
  assert.equal(flow.step, 'squeeze', 'never advanced past the centre step');

  feed(flow, STILL_FRAMES, { curl: 1.05 });
  assert.equal(flow.step, 'done');

  const result = flow.take();
  assert.ok(result);
  assert.deepEqual(result.origin, { y: 0.58, depth: 0.37 });
  assert.ok(Math.abs(result.calibration.openRatio - 1.9) < 1e-9);
  assert.ok(Math.abs(result.calibration.fistRatio - 1.05) < 1e-9);

  // take() is one-shot.
  assert.equal(flow.take(), null);
});

test('a moving hand never commits a capture', () => {
  const flow = new SetupFlow();
  flow.start();

  // This is the bug the stillness gate exists for: grabbing the centre while
  // the hand is still being raised into frame.
  feed(flow, STILL_FRAMES * 4, { speed: STILL_SPEED + 0.01 });
  assert.equal(flow.step, 'centre');
  assert.equal(flow.progress, 0);
});

test('movement partway through restarts the count', () => {
  const flow = new SetupFlow();
  flow.start();

  feed(flow, STILL_FRAMES - 2);
  assert.ok(flow.progress > 0.8);

  feed(flow, 1, { speed: 0.4 });
  assert.equal(flow.progress, 0);
  assert.equal(flow.step, 'centre');

  feed(flow, STILL_FRAMES);
  assert.equal(flow.step, 'squeeze');
});

test('losing the hand restarts the count and says so', () => {
  const flow = new SetupFlow();
  flow.start();

  feed(flow, STILL_FRAMES - 3);
  feed(flow, 1, { present: false });
  assert.equal(flow.progress, 0);
  assert.match(flow.prompt, /Show your hand/);
});

test('a fist that looks like an open hand is rejected, not stored', () => {
  const flow = new SetupFlow();
  flow.start();

  feed(flow, STILL_FRAMES, { curl: 1.85 });
  assert.equal(flow.step, 'squeeze');

  // Barely closed — the gap is under the usable spread.
  feed(flow, STILL_FRAMES, { curl: 1.75 });
  assert.equal(flow.step, 'squeeze', 'accepted a useless calibration');
  assert.equal(flow.result, null);
  assert.match(flow.prompt, /squeeze harder/i);

  // A real fist then works.
  feed(flow, STILL_FRAMES, { curl: 1.02 });
  assert.equal(flow.step, 'done');
  assert.ok(flow.take());
});

test('one bad frame does not skew a capture', () => {
  const flow = new SetupFlow();
  flow.start();

  for (let i = 0; i < STILL_FRAMES; i += 1) {
    flow.update(frame({ curl: i === 4 ? 42 : 1.88 }));
  }
  feed(flow, STILL_FRAMES, { curl: 1.03 });

  const result = flow.take();
  assert.ok(result);
  assert.ok(
    Math.abs(result.calibration.openRatio - 1.88) < 1e-9,
    `outlier moved the open ratio to ${result.calibration.openRatio}`,
  );
});

test('still frames with no usable reading wait rather than committing', () => {
  const flow = new SetupFlow();
  flow.start();

  feed(flow, STILL_FRAMES * 2, { curl: null });
  assert.equal(flow.step, 'centre');
  assert.equal(flow.result, null);
  assert.match(flow.prompt, /fully into frame/i);
});

test('cancel returns it to idle', () => {
  const flow = new SetupFlow();
  flow.start();
  feed(flow, STILL_FRAMES - 1);

  flow.cancel();
  assert.equal(flow.step, 'idle');
  assert.equal(flow.running, false);
  assert.equal(flow.progress, 0);

  feed(flow, STILL_FRAMES * 2);
  assert.equal(flow.result, null);
});

test('the prompt always says what to do next', () => {
  const flow = new SetupFlow();
  flow.start();
  assert.match(flow.prompt, /open/i);

  feed(flow, STILL_FRAMES);
  assert.match(flow.prompt, /fist/i);

  feed(flow, STILL_FRAMES, { curl: 1.02 });
  assert.match(flow.prompt, /set/i);
});
