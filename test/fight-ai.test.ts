import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_FIGHT, DIFFICULTIES, FightAi, type FightOptions } from '../src/game/fight-ai.js';

/** Deterministic: never chooses to guard unless told to. */
const NEVER = { ...DEFAULT_FIGHT, random: () => 1 };
const ALWAYS = { ...DEFAULT_FIGHT, random: () => 0 };

function run(
  ai: FightAi,
  seconds: number,
  head: { x: number; z: number } | null,
  winding = false,
): { punches: number } {
  const dt = 1 / 60;
  let punches = 0;
  for (let i = 0; i < Math.round(seconds / dt); i += 1) {
    if (ai.update(dt, { playerHead: head, playerWindingUp: winding }).punched) punches += 1;
  }
  return { punches };
}

test('with nobody in front of it, it stands there', () => {
  const ai = new FightAi(NEVER);
  const start = { x: ai.x, z: ai.z };
  run(ai, 2, null);

  assert.equal(ai.state, 'idle');
  assert.deepEqual({ x: ai.x, z: ai.z }, start);
});

test('it closes the distance when you are far away', () => {
  const ai = new FightAi(NEVER);
  const head = { x: 0, z: 1.2 };
  const before = Math.hypot(head.x - ai.x, head.z - ai.z);

  run(ai, 1, head);
  const after = Math.hypot(head.x - ai.x, head.z - ai.z);
  assert.ok(after < before - 0.1, `closed only ${(before - after).toFixed(3)}m`);
});

test('it backs off when you crowd it', () => {
  const ai = new FightAi(NEVER);
  const head = { x: ai.x, z: ai.z + 0.05 };
  const before = Math.hypot(head.x - ai.x, head.z - ai.z);

  run(ai, 0.5, head);
  assert.ok(Math.hypot(head.x - ai.x, head.z - ai.z) > before);
});

test('it stays inside its arena however far you run', () => {
  const ai = new FightAi(NEVER);
  run(ai, 10, { x: 50, z: 50 });

  const { arena } = DEFAULT_FIGHT;
  assert.ok(ai.x <= arena.maxX + 1e-6 && ai.x >= arena.minX - 1e-6);
  assert.ok(ai.z <= arena.maxZ + 1e-6 && ai.z >= arena.minZ - 1e-6);
});

test('it winds up before it punches, so you can read it', () => {
  const ai = new FightAi(NEVER);
  const head = { x: ai.x, z: ai.z + DEFAULT_FIGHT.preferredRange - 0.02 };

  // Find the wind-up.
  let sawWind = false;
  for (let i = 0; i < 200; i += 1) {
    ai.update(1 / 60, { playerHead: head, playerWindingUp: false });
    if (ai.state === 'wind') {
      sawWind = true;
      break;
    }
  }
  assert.ok(sawWind, 'went straight to a strike with no telegraph');

  // And the wind-up visibly progresses rather than snapping.
  const early = ai.windProgress;
  run(ai, DEFAULT_FIGHT.windSeconds * 0.5, head);
  assert.ok(ai.windProgress > early);
});

test('a punch connects if you stand there, and misses if you step back', () => {
  const stand = new FightAi(NEVER);
  const close = { x: stand.x, z: stand.z + DEFAULT_FIGHT.preferredRange - 0.05 };
  assert.ok(run(stand, 4, close).punches > 0, 'never landed one');

  const dodge = new FightAi(NEVER);
  const far = { x: dodge.x, z: dodge.z + 1.4 };
  assert.equal(run(dodge, 4, far).punches, 0, 'landed a punch from across the room');
});

test('it does not punch faster than its cooldown', () => {
  const ai = new FightAi(NEVER);
  const head = { x: ai.x, z: ai.z + DEFAULT_FIGHT.preferredRange - 0.05 };

  const seconds = 6;
  const { punches } = run(ai, seconds, head);
  const cycle = DEFAULT_FIGHT.cooldownSeconds + DEFAULT_FIGHT.windSeconds + DEFAULT_FIGHT.recoverSeconds;
  assert.ok(punches <= Math.ceil(seconds / cycle) + 1, `threw ${punches} in ${seconds}s`);
});

test('it guards when it reads your wind-up, and only then', () => {
  const watchful = new FightAi(ALWAYS);
  run(watchful, 0.2, { x: 0, z: 0.6 }, true);
  assert.ok(watchful.guarding);

  const oblivious = new FightAi(NEVER);
  run(oblivious, 0.2, { x: 0, z: 0.6 }, true);
  assert.equal(oblivious.guarding, false);
});

test('being hit interrupts a wind-up and knocks it back', () => {
  const ai = new FightAi(NEVER);
  const head = { x: ai.x, z: ai.z + DEFAULT_FIGHT.preferredRange - 0.02 };
  for (let i = 0; i < 200 && ai.state !== 'wind'; i += 1) {
    ai.update(1 / 60, { playerHead: head, playerWindingUp: false });
  }

  const beforeZ = ai.z;
  ai.hit({ x: 0, z: -1 }, 1);
  assert.equal(ai.state, 'stagger');
  assert.equal(ai.windProgress, 0, 'kept winding up through a punch to the face');
  assert.ok(ai.z < beforeZ, 'no knockback');

  run(ai, DEFAULT_FIGHT.staggerSeconds + 0.2, head);
  assert.notEqual(ai.state, 'stagger');
});

test('knockback cannot punt it out of the arena', () => {
  const ai = new FightAi(NEVER);
  ai.hit({ x: 1, z: 1 }, 500);
  const { arena } = DEFAULT_FIGHT;
  assert.ok(ai.x <= arena.maxX + 1e-6 && ai.z <= arena.maxZ + 1e-6);
});

test('it turns to face you rather than snapping round', () => {
  const ai = new FightAi(NEVER);
  const behind = { x: 0.9, z: ai.z - 0.9 };

  ai.update(1 / 60, { playerHead: behind, playerWindingUp: false });
  const afterOneFrame = ai.facing;
  run(ai, 1.5, behind);

  assert.notEqual(afterOneFrame, ai.facing);
  assert.ok(Number.isFinite(ai.facing));
});

test('a target wobbling on the range threshold does not make it stutter', () => {
  // This is the bug the hysteresis exists for: tracked head position carries a
  // couple of centimetres of noise, and a bare threshold turns that into a new
  // movement decision every single frame.
  const ai = new FightAi(NEVER);
  const dt = 1 / 60;

  let changes = 0;
  let previous = ai.state;
  for (let i = 0; i < 60 * 4; i += 1) {
    // Sitting right on preferredRange, jittering 2cm either side.
    const wobble = Math.sin(i * 2.7) * 0.02;
    const head = { x: ai.x, z: ai.z + DEFAULT_FIGHT.preferredRange + wobble };
    ai.update(dt, { playerHead: head, playerWindingUp: false });

    // Punching states are driven by their own timers, not by the threshold.
    const movement = ai.state === 'approach' || ai.state === 'retreat' || ai.state === 'idle';
    if (movement && ai.state !== previous) changes += 1;
    if (movement) previous = ai.state;
  }

  // Four seconds at 60fps is 240 chances to flip. A handful is fine; dozens is
  // the stutter.
  assert.ok(changes < 15, `movement state changed ${changes} times on a steady target`);
});

test('it never winds up from inside its own guard', () => {
  const ai = new FightAi(NEVER);
  const crowding = { x: ai.x, z: ai.z + DEFAULT_FIGHT.tooClose * 0.4 };

  let sawWind = false;
  for (let i = 0; i < 120; i += 1) {
    ai.update(1 / 60, { playerHead: crowding, playerWindingUp: false });
    if (ai.state === 'wind' || ai.state === 'strike') sawWind = true;
    // Once it has backed off far enough, winding up is legitimate again.
    if (Math.hypot(crowding.x - ai.x, crowding.z - ai.z) >= DEFAULT_FIGHT.tooClose) break;
  }

  assert.equal(sawWind, false, 'threw a punch from point-blank instead of stepping back');
});

test('a single bad frame does not knock it off course for long', () => {
  const ai = new FightAi(NEVER);
  const far = () => ({ x: ai.x, z: ai.z + 1.2 });

  for (let i = 0; i < 30; i += 1) ai.update(1 / 60, { playerHead: far(), playerWindingUp: false });
  assert.equal(ai.state, 'approach');

  // One frame reporting the target as in-range — a tracking blip. Stopping for
  // it is correct; what matters is that it picks the walk back up rather than
  // oscillating or freezing.
  ai.update(1 / 60, {
    playerHead: { x: ai.x, z: ai.z + DEFAULT_FIGHT.preferredRange - 0.01 },
    playerWindingUp: false,
  });

  for (let i = 0; i < 20; i += 1) ai.update(1 / 60, { playerHead: far(), playerWindingUp: false });
  assert.equal(ai.state, 'approach', 'never resumed after a one-frame blip');
});

test('one bad tracking frame cannot commit it to a punch', () => {
  // A punch is a second-long animation it can't take back, so it must not be
  // triggered by a single frame that happened to report you in range.
  const ai = new FightAi(NEVER);
  const far = () => ({ x: ai.x, z: ai.z + 1.2 });

  for (let i = 0; i < 30; i += 1) ai.update(1 / 60, { playerHead: far(), playerWindingUp: false });
  assert.equal(ai.state, 'approach');

  ai.update(1 / 60, {
    playerHead: { x: ai.x, z: ai.z + DEFAULT_FIGHT.preferredRange - 0.01 },
    playerWindingUp: false,
  });
  assert.notEqual(ai.state, 'wind', 'threw a punch at nothing off one frame');
  assert.notEqual(ai.state, 'strike');
});

test('harder difficulties are actually harder', () => {
  const easy: FightOptions = DIFFICULTIES.easy;
  const hard: FightOptions = DIFFICULTIES.hard;

  assert.ok(hard.speed > easy.speed);
  assert.ok(hard.cooldownSeconds < easy.cooldownSeconds);
  assert.ok(hard.awareness > easy.awareness);
  // Sharper reactions, but still never sharp enough to stutter.
  assert.ok(hard.minDwellSeconds > 0);
  // And it telegraphs less, so you have less time to react.
  assert.ok(hard.windSeconds < easy.windSeconds);
});

test('zero, negative and stalled frames are safe', () => {
  const ai = new FightAi(NEVER);
  const before = { x: ai.x, z: ai.z };
  ai.update(0, { playerHead: { x: 0, z: 1 }, playerWindingUp: false });
  ai.update(-1, { playerHead: { x: 0, z: 1 }, playerWindingUp: false });
  assert.deepEqual({ x: ai.x, z: ai.z }, before);

  ai.update(5, { playerHead: { x: 0, z: 1 }, playerWindingUp: false });
  assert.ok(Math.abs(ai.z - before.z) < DEFAULT_FIGHT.speed * 0.1 + 1e-6);
});
