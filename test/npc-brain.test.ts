import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_NPC, NpcBrain, angleDelta } from '../src/interact/npc-brain.js';

/** Run the brain for `seconds` at 60fps. */
function run(brain: NpcBrain, seconds: number, player: { x: number; z: number } | null = null) {
  const dt = 1 / 60;
  for (let i = 0; i < Math.round(seconds / dt); i += 1) brain.update(dt, player);
}

test('it starts in the middle of its beat and paces', () => {
  const brain = new NpcBrain();
  const startX = brain.x;
  run(brain, 0.5);
  assert.notEqual(brain.x, startX);
  assert.equal(brain.state, 'patrol');
});

test('it turns around at the ends rather than walking out of the box', () => {
  const brain = new NpcBrain();
  const seen: number[] = [];
  for (let i = 0; i < 60 * 20; i += 1) {
    brain.update(1 / 60, null);
    seen.push(brain.x);
  }

  assert.ok(Math.min(...seen) >= DEFAULT_NPC.bounds.minX - 1e-6);
  assert.ok(Math.max(...seen) <= DEFAULT_NPC.bounds.maxX + 1e-6);
  // It should have covered most of its beat, not stalled in a corner.
  assert.ok(Math.max(...seen) - Math.min(...seen) > (DEFAULT_NPC.bounds.maxX - DEFAULT_NPC.bounds.minX) * 0.8);
});

test('it stops and faces you when you get close', () => {
  const brain = new NpcBrain();
  const player = { x: brain.x, z: brain.z + 0.12 };

  run(brain, 0.4, player);
  assert.equal(brain.state, 'face');

  const settledX = brain.x;
  run(brain, 1, player);
  assert.ok(Math.abs(brain.x - settledX) < 1e-6, 'it kept walking while facing');
});

test('it turns toward the player rather than snapping', () => {
  const brain = new NpcBrain();
  // Player off to one side, well inside the notice radius.
  const player = { x: brain.x + 0.2, z: brain.z + 0.15 };

  brain.update(1 / 60, player);
  const afterOneFrame = brain.facing;

  run(brain, 1.2, player);
  const target = Math.atan2(player.x - brain.x, player.z - brain.z);

  assert.ok(Math.abs(angleDelta(afterOneFrame, target)) > 0.05, 'it snapped in one frame');
  assert.ok(Math.abs(angleDelta(brain.facing, target)) < 0.05, 'it never finished turning');
});

test('a hit staggers it, knocks it back, then it recovers', () => {
  const brain = new NpcBrain();
  const startX = brain.x;

  brain.hit({ x: 1, z: 0 }, 3);
  assert.equal(brain.state, 'stagger');
  assert.ok(brain.staggerAmount > 0.9);

  run(brain, 0.2);
  assert.ok(brain.x > startX, 'no knockback');
  assert.ok(brain.staggerAmount < 1 && brain.staggerAmount > 0);

  run(brain, DEFAULT_NPC.staggerSeconds + 0.2);
  assert.equal(brain.state, 'patrol');
  assert.equal(brain.staggerAmount, 0);
});

test('a harder hit knocks it further', () => {
  const soft = new NpcBrain();
  const hard = new NpcBrain();
  const start = soft.x;

  soft.hit({ x: 1, z: 0 }, 1);
  hard.hit({ x: 1, z: 0 }, 4);
  run(soft, 0.3);
  run(hard, 0.3);

  assert.ok(hard.x - start > soft.x - start);
});

test('knockback cannot push it out of its box', () => {
  const brain = new NpcBrain();
  brain.hit({ x: 1, z: 1 }, 500);
  run(brain, 2);

  assert.ok(brain.x <= DEFAULT_NPC.bounds.maxX + 1e-6);
  assert.ok(brain.z <= DEFAULT_NPC.bounds.maxZ + 1e-6);
  assert.ok(brain.x >= DEFAULT_NPC.bounds.minX - 1e-6);
  assert.ok(brain.z >= DEFAULT_NPC.bounds.minZ - 1e-6);
});

test('being hit interrupts facing you', () => {
  const brain = new NpcBrain();
  const player = { x: brain.x, z: brain.z + 0.1 };
  run(brain, 0.3, player);
  assert.equal(brain.state, 'face');

  brain.hit({ x: -1, z: 0 }, 2);
  brain.update(1 / 60, player);
  assert.equal(brain.state, 'stagger');
});

test('zero, negative and stalled timesteps are safe', () => {
  const brain = new NpcBrain();
  const before = { x: brain.x, z: brain.z };
  brain.update(0, null);
  brain.update(-1, null);
  assert.deepEqual({ x: brain.x, z: brain.z }, before);

  // A backgrounded tab handing back five seconds must not warp it.
  brain.update(5, null);
  assert.ok(brain.x <= DEFAULT_NPC.bounds.maxX + 1e-6);
  assert.ok(Number.isFinite(brain.facing));
});

test('angleDelta takes the short way round', () => {
  assert.ok(Math.abs(angleDelta(0, 0.2) - 0.2) < 1e-12);
  // Almost a full turn forward is a small turn backward.
  assert.ok(Math.abs(angleDelta(0, Math.PI * 1.9) - -Math.PI * 0.1) < 1e-12);
  assert.ok(Math.abs(angleDelta(Math.PI * 0.9, -Math.PI * 0.9) - Math.PI * 0.2) < 1e-12);
});
