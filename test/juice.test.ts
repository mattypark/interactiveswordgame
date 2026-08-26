import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  COMBO_SHOW_AT,
  COMBO_WINDOW_MS,
  Combo,
  HIT_STOP_SECONDS,
  HitStop,
  SHAKE_AMPLITUDE,
  Shake,
  comboMultiplier,
} from '../src/game/juice.js';

test('hit stop passes time straight through when nothing has landed', () => {
  const stop = new HitStop();
  assert.equal(stop.active, false);
  assert.equal(stop.step(1 / 60), 1 / 60);
});

test('a hit freezes the world, then hands time back', () => {
  const stop = new HitStop();
  stop.hit(1);
  assert.ok(stop.active);

  let frozen = 0;
  let out = 0;
  for (let i = 0; i < 20 && out === 0; i += 1) {
    out = stop.step(1 / 60);
    if (out === 0) frozen += 1 / 60;
  }

  assert.ok(frozen > 0, 'never actually froze');
  assert.ok(frozen <= HIT_STOP_SECONDS + 1 / 60, `froze for ${frozen}s`);
  assert.equal(stop.active, false);
});

test('the frame that ends a freeze is not also lost', () => {
  const stop = new HitStop();
  stop.hit(1);
  // One huge frame: everything past the freeze should still be returned.
  const out = stop.step(1);
  assert.ok(out > 0.8, `swallowed the whole frame, returned ${out}`);
});

test('a second hit during a freeze extends it rather than shortening it', () => {
  const stop = new HitStop();
  stop.hit(1);
  stop.step(HIT_STOP_SECONDS * 0.5);
  stop.hit(0.2); // a weaker hit
  assert.ok(stop.active, 'a weak follow-up cut the freeze short');
});

test('a harder hit freezes longer', () => {
  const soft = new HitStop();
  const hard = new HitStop();
  soft.hit(0);
  hard.hit(1);

  let softFrames = 0;
  let hardFrames = 0;
  while (soft.step(1 / 240) === 0) softFrames += 1;
  while (hard.step(1 / 240) === 0) hardFrames += 1;
  assert.ok(hardFrames > softFrames);
});

test('shake starts at nothing and returns to nothing', () => {
  const shake = new Shake();
  assert.deepEqual(shake.offset, { x: 0, y: 0 });
  assert.equal(shake.fovKick, 0);

  shake.hit(1);
  shake.step(1 / 60);
  assert.ok(Math.hypot(shake.offset.x, shake.offset.y) > 0);
  assert.ok(shake.fovKick > 0);

  for (let i = 0; i < 120; i += 1) shake.step(1 / 60);
  assert.deepEqual(shake.offset, { x: 0, y: 0 });
  assert.equal(shake.fovKick, 0);
});

test('shake is bounded, so a huge hit cannot throw the camera off', () => {
  const shake = new Shake();
  shake.hit(50);
  for (let i = 0; i < 30; i += 1) {
    shake.step(1 / 60);
    assert.ok(Math.abs(shake.offset.x) <= SHAKE_AMPLITUDE + 1e-9);
    assert.ok(Math.abs(shake.offset.y) <= SHAKE_AMPLITUDE + 1e-9);
  }
});

test('a combo counts consecutive hits and expires on its own', () => {
  const combo = new Combo();
  assert.equal(combo.hit(0), 1);
  assert.equal(combo.hit(300), 2);
  assert.equal(combo.hit(600), 3);
  assert.ok(combo.visible);

  // A long gap starts over rather than continuing.
  assert.equal(combo.hit(600 + COMBO_WINDOW_MS + 1), 1);
});

test('a combo drops when the window runs out with no input', () => {
  const combo = new Combo();
  combo.hit(0);
  combo.hit(200);
  assert.equal(combo.count, 2);

  combo.update(200 + COMBO_WINDOW_MS - 1);
  assert.equal(combo.count, 2, 'expired early');

  combo.update(200 + COMBO_WINDOW_MS + 1);
  assert.equal(combo.count, 0);
});

test('the combo timer drains rather than jumping', () => {
  const combo = new Combo();
  combo.hit(0);
  assert.ok(Math.abs(combo.remaining(0) - 1) < 1e-9);
  assert.ok(Math.abs(combo.remaining(COMBO_WINDOW_MS / 2) - 0.5) < 1e-9);
  assert.equal(combo.remaining(COMBO_WINDOW_MS * 2), 0);
});

test('a single hit is not a combo', () => {
  const combo = new Combo();
  combo.hit(0);
  assert.equal(combo.visible, COMBO_SHOW_AT <= 1);
  combo.hit(200);
  assert.ok(combo.visible);
});

test('the combo bonus rewards a streak without running away with the match', () => {
  assert.equal(comboMultiplier(0), 1);
  assert.equal(comboMultiplier(1), 1);
  assert.ok(comboMultiplier(3) > comboMultiplier(2));
  assert.ok(comboMultiplier(50) <= 1.5, 'an endless combo would end rounds instantly');
});

test('reset clears everything', () => {
  const stop = new HitStop();
  const shake = new Shake();
  const combo = new Combo();
  stop.hit(1);
  shake.hit(1);
  combo.hit(0);

  stop.reset();
  shake.reset();
  combo.reset();

  assert.equal(stop.active, false);
  assert.deepEqual(shake.offset, { x: 0, y: 0 });
  assert.equal(combo.count, 0);
});
