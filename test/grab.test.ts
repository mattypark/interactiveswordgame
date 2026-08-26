import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  GRAB_MARGIN,
  GRAB_OFF,
  GRAB_ON,
  GrabController,
  findTarget,
  type Aabb,
} from '../src/interact/grab.js';
import type { Vec3 } from '../src/hands/project.js';

/** A 9cm cube, like the clay block, centred on `centre`. */
function cube(id: string, centre: Vec3, size = 0.09): Aabb {
  const half = size / 2;
  return {
    id,
    min: { x: centre.x - half, y: centre.y - half, z: centre.z - half },
    max: { x: centre.x + half, y: centre.y + half, z: centre.z + half },
  };
}

const AT_ORIGIN = cube('clay-1', { x: 0, y: 0.045, z: 0 });
const INSIDE: Vec3 = { x: 0, y: 0.045, z: 0 };
const FAR_AWAY: Vec3 = { x: 0.9, y: 0.4, z: 0.3 };

test('a palm inside the bounds finds the box', () => {
  assert.equal(findTarget(INSIDE, [AT_ORIGIN]), 'clay-1');
});

test('a palm nowhere near it finds nothing', () => {
  assert.equal(findTarget(FAR_AWAY, [AT_ORIGIN]), null);
  assert.equal(findTarget(INSIDE, []), null);
});

test('the margin extends reach, but only so far', () => {
  // Fingers close around an object, so the palm centre sits just outside it.
  const justOutside: Vec3 = { x: 0.045 + GRAB_MARGIN * 0.8, y: 0.045, z: 0 };
  assert.equal(findTarget(justOutside, [AT_ORIGIN]), 'clay-1');

  const beyondMargin: Vec3 = { x: 0.045 + GRAB_MARGIN * 1.5, y: 0.045, z: 0 };
  assert.equal(findTarget(beyondMargin, [AT_ORIGIN]), null);
});

test('overlapping boxes resolve to the nearest centre', () => {
  const near = cube('near', { x: 0.01, y: 0.045, z: 0 });
  const far = cube('far', { x: 0.06, y: 0.045, z: 0 });
  assert.equal(findTarget({ x: 0.01, y: 0.045, z: 0 }, [far, near]), 'near');
  // Order of the list must not decide it.
  assert.equal(findTarget({ x: 0.01, y: 0.045, z: 0 }, [near, far]), 'near');
});

test('hovering without squeezing reports a target but holds nothing', () => {
  const controller = new GrabController();
  const { state, event } = controller.update(true, INSIDE, GRAB_ON - 0.05, [AT_ORIGIN]);

  assert.equal(state.hit, true);
  assert.equal(state.target, 'clay-1');
  assert.equal(state.held, null);
  assert.equal(event, null);
});

test('squeezing on a target grabs it, once', () => {
  const controller = new GrabController();
  const first = controller.update(true, INSIDE, GRAB_ON, [AT_ORIGIN]);
  assert.deepEqual(first.event, { type: 'grab', id: 'clay-1' });
  assert.equal(first.state.held, 'clay-1');

  // Still squeezing on the next frame: held, but no second grab event.
  const second = controller.update(true, INSIDE, 0.9, [AT_ORIGIN]);
  assert.equal(second.event, null);
  assert.equal(second.state.held, 'clay-1');
});

test('squeezing on empty air grabs nothing', () => {
  const controller = new GrabController();
  const { state, event } = controller.update(true, FAR_AWAY, 1, [AT_ORIGIN]);
  assert.equal(state.held, null);
  assert.equal(state.hit, false);
  assert.equal(event, null);
});

test('the hysteresis band keeps a wobbling grip from dropping the block', () => {
  const controller = new GrabController();
  controller.update(true, INSIDE, GRAB_ON, [AT_ORIGIN]);

  // Between the two thresholds — the grip a hand actually sits at while
  // carrying something. It must not let go here.
  const wobble = (GRAB_ON + GRAB_OFF) / 2;
  const held = controller.update(true, INSIDE, wobble, [AT_ORIGIN]);
  assert.equal(held.state.held, 'clay-1');
  assert.equal(held.event, null);

  const released = controller.update(true, INSIDE, GRAB_OFF - 0.01, [AT_ORIGIN]);
  assert.deepEqual(released.event, { type: 'release', id: 'clay-1' });
  assert.equal(released.state.held, null);
});

test('a held block travels with the hand, even outside its old bounds', () => {
  const controller = new GrabController();
  controller.update(true, INSIDE, 1, [AT_ORIGIN]);

  // The palm has moved far from where the block used to be — which is exactly
  // what carrying it looks like. It must not be dropped for leaving the box.
  const carried = controller.update(true, FAR_AWAY, 1, [AT_ORIGIN]);
  assert.equal(carried.state.held, 'clay-1');
  assert.equal(carried.event, null);
});

test('losing the hand drops what it was carrying', () => {
  const controller = new GrabController();
  controller.update(true, INSIDE, 1, [AT_ORIGIN]);

  const lost = controller.update(false, INSIDE, 1, [AT_ORIGIN]);
  assert.deepEqual(lost.event, { type: 'release', id: 'clay-1' });
  assert.equal(lost.state.held, null);
  assert.equal(lost.state.hit, false);

  // And it stays dropped rather than firing release every frame after.
  assert.equal(controller.update(false, INSIDE, 1, [AT_ORIGIN]).event, null);
});

test('deleting the held block clears the hold without a phantom release', () => {
  const controller = new GrabController();
  controller.update(true, INSIDE, 1, [AT_ORIGIN]);

  const gone = controller.update(true, INSIDE, 1, []);
  assert.equal(gone.state.held, null);
  assert.equal(gone.event, null, 'released an object that no longer exists');
});

test('re-grabbing after a release works', () => {
  const controller = new GrabController();
  controller.update(true, INSIDE, 1, [AT_ORIGIN]);
  controller.update(true, INSIDE, 0, [AT_ORIGIN]);

  const again = controller.update(true, INSIDE, 1, [AT_ORIGIN]);
  assert.deepEqual(again.event, { type: 'grab', id: 'clay-1' });
});

test('clear() forces a release without an event', () => {
  const controller = new GrabController();
  controller.update(true, INSIDE, 1, [AT_ORIGIN]);
  controller.clear();
  assert.equal(controller.held, null);
});
