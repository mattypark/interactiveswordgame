import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_PHYSICS,
  MAX_STEP,
  MAX_THROW_SPEED,
  clampThrow,
  step,
  type Body,
} from '../src/interact/physics.js';

function body(overrides: Partial<Body> = {}): Body {
  return {
    position: { x: 0, y: 0.5, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    radius: 0.045,
    awake: true,
    ...overrides,
  };
}

/** Run the sim for `seconds` at 60fps. */
function simulate(target: Body, seconds: number, options = DEFAULT_PHYSICS): void {
  const dt = 1 / 60;
  for (let i = 0; i < Math.round(seconds / dt); i += 1) step(target, dt, options);
}

test('a released block falls', () => {
  const b = body();
  const startY = b.position.y;
  simulate(b, 0.2);
  assert.ok(b.position.y < startY);
});

test('a thrown block travels in the direction it was thrown', () => {
  const b = body({ velocity: { x: 2.5, y: 1.2, z: -0.8 } });
  simulate(b, 0.35);
  assert.ok(b.position.x > 0.3, `only reached x=${b.position.x.toFixed(3)}`);
  assert.ok(b.position.z < -0.1);
});

test('a block always comes to rest on the floor, not through it', () => {
  const b = body({ position: { x: 0, y: 1.5, z: 0 }, velocity: { x: 1.5, y: 0, z: 0.4 } });
  simulate(b, 12);

  assert.equal(b.awake, false, 'block never settled');
  assert.ok(
    Math.abs(b.position.y - (DEFAULT_PHYSICS.bounds.min.y + b.radius)) < 1e-6,
    `resting at y=${b.position.y}`,
  );
  assert.deepEqual(b.velocity, { x: 0, y: 0, z: 0 });
});

test('a sleeping block stays put until something wakes it', () => {
  const b = body({ position: { x: 0.2, y: 0.045, z: 0.1 }, awake: false });
  const before = { ...b.position };
  simulate(b, 3);
  assert.deepEqual(b.position, before);
});

test('a block cannot be thrown out of the room', () => {
  const b = body({ velocity: { x: 40, y: 20, z: -40 } });
  simulate(b, 6);

  const { min, max } = DEFAULT_PHYSICS.bounds;
  assert.ok(b.position.x >= min.x + b.radius - 1e-6 && b.position.x <= max.x - b.radius + 1e-6);
  assert.ok(b.position.y >= min.y + b.radius - 1e-6 && b.position.y <= max.y - b.radius + 1e-6);
  assert.ok(b.position.z >= min.z + b.radius - 1e-6 && b.position.z <= max.z - b.radius + 1e-6);
});

test('a bounce loses energy rather than gaining it', () => {
  const b = body({ position: { x: 0, y: 1.2, z: 0 } });
  simulate(b, 0.6);
  const firstPeak = b.position.y;
  simulate(b, 2.5);
  assert.ok(b.position.y <= firstPeak + 1e-6, 'block bounced higher than it fell from');
});

test('drag is frame-rate independent', () => {
  const fast = body({ velocity: { x: 3, y: 0, z: 0 } });
  const slow = body({ velocity: { x: 3, y: 0, z: 0 } });

  for (let i = 0; i < 120; i += 1) step(fast, 1 / 120, DEFAULT_PHYSICS);
  for (let i = 0; i < 30; i += 1) step(slow, 1 / 30, DEFAULT_PHYSICS);

  assert.ok(
    Math.abs(fast.position.x - slow.position.x) < 0.05,
    `120fps landed at ${fast.position.x.toFixed(3)}, 30fps at ${slow.position.x.toFixed(3)}`,
  );
});

test('a long stall does not teleport the block across the room', () => {
  const b = body({ velocity: { x: 3, y: 0, z: 0 } });
  // A backgrounded tab handing back a five-second frame.
  step(b, 5, DEFAULT_PHYSICS);
  assert.ok(b.position.x < 3 * MAX_STEP + 1e-6, `moved ${b.position.x} in one step`);
});

test('zero and negative timesteps are ignored', () => {
  const b = body({ velocity: { x: 2, y: 0, z: 0 } });
  const before = { ...b.position };
  step(b, 0, DEFAULT_PHYSICS);
  step(b, -1, DEFAULT_PHYSICS);
  assert.deepEqual(b.position, before);
});

test('throw speed is capped, keeping direction', () => {
  const wild = clampThrow({ x: 40, y: 0, z: 0 });
  assert.ok(Math.abs(wild.x - MAX_THROW_SPEED) < 1e-9);

  const gentle = clampThrow({ x: 0.4, y: 0.2, z: 0 });
  assert.deepEqual(gentle, { x: 0.4, y: 0.2, z: 0 });

  const diagonal = clampThrow({ x: 30, y: 30, z: 0 });
  assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.y, diagonal.z) - MAX_THROW_SPEED) < 1e-6);
  assert.ok(Math.abs(diagonal.x - diagonal.y) < 1e-9, 'direction changed');

  assert.deepEqual(clampThrow({ x: 0, y: 0, z: 0 }), { x: 0, y: 0, z: 0 });
});
