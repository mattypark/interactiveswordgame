import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  HISTORY_LIMIT,
  History,
  cloneTransform,
  transformsEqual,
  type HistoryTarget,
  type ObjectSnapshot,
  type Transform,
} from '../src/interact/history.js';

function transform(x: number, scale = 1): Transform {
  return { position: [x, 0, 0], quaternion: [0, 0, 0, 1], scale: [scale, scale, scale] };
}

function snapshot(id: string, x = 0): ObjectSnapshot {
  return { id, kind: 'clay', transform: transform(x) };
}

/** Records what the stack asked the scene to do. */
function fakeScene() {
  const live = new Map<string, Transform>();
  const log: string[] = [];
  const target: HistoryTarget = {
    create(snap) {
      live.set(snap.id, cloneTransform(snap.transform));
      log.push(`create:${snap.id}`);
    },
    destroy(id) {
      live.delete(id);
      log.push(`destroy:${id}`);
    },
    setTransform(id, next) {
      live.set(id, cloneTransform(next));
      log.push(`set:${id}:${next.position[0]}`);
    },
  };
  return { target, live, log };
}

test('undoing a spawn destroys it, redoing brings it back', () => {
  const scene = fakeScene();
  const history = new History(scene.target);
  scene.target.create(snapshot('clay-1'));

  history.push({ type: 'spawn', snapshot: snapshot('clay-1') });
  assert.ok(history.canUndo);

  history.undo();
  assert.equal(scene.live.has('clay-1'), false);
  assert.ok(history.canRedo);

  history.redo();
  assert.equal(scene.live.has('clay-1'), true);
});

test('undoing a delete restores it with its transform', () => {
  const scene = fakeScene();
  const history = new History(scene.target);

  history.push({ type: 'delete', snapshot: snapshot('clay-2', 0.4) });
  history.undo();

  assert.deepEqual(scene.live.get('clay-2')?.position, [0.4, 0, 0]);

  history.redo();
  assert.equal(scene.live.has('clay-2'), false);
});

test('undoing a transform restores the pose from before the grab', () => {
  const scene = fakeScene();
  const history = new History(scene.target);
  scene.target.create(snapshot('clay-3'));

  history.push({ type: 'transform', id: 'clay-3', before: transform(0), after: transform(0.5) });

  history.undo();
  assert.deepEqual(scene.live.get('clay-3')?.position, [0, 0, 0]);

  history.redo();
  assert.deepEqual(scene.live.get('clay-3')?.position, [0.5, 0, 0]);
});

test('a transform that changed nothing is not recorded', () => {
  const scene = fakeScene();
  const history = new History(scene.target);

  // Squeezing and releasing without moving would otherwise leave an undo step
  // that appears to do nothing when you press it.
  history.push({ type: 'transform', id: 'clay-4', before: transform(0.2), after: transform(0.2) });
  assert.equal(history.canUndo, false);
  assert.equal(history.depth, 0);
});

test('a new action abandons the redo branch', () => {
  const scene = fakeScene();
  const history = new History(scene.target);

  history.push({ type: 'spawn', snapshot: snapshot('a') });
  history.undo();
  assert.ok(history.canRedo);

  history.push({ type: 'spawn', snapshot: snapshot('b') });
  assert.equal(history.canRedo, false, 'redo survived a new action');
});

test('undo and redo on an empty stack are safe no-ops', () => {
  const scene = fakeScene();
  const history = new History(scene.target);

  assert.equal(history.undo(), null);
  assert.equal(history.redo(), null);
  assert.deepEqual(scene.log, []);
});

test('a long session does not grow the stack without bound', () => {
  const scene = fakeScene();
  const history = new History(scene.target);

  for (let i = 0; i < HISTORY_LIMIT + 25; i += 1) {
    history.push({ type: 'spawn', snapshot: snapshot(`clay-${i}`) });
  }
  assert.equal(history.depth, HISTORY_LIMIT);
});

test('round-tripping many steps lands back where it started', () => {
  const scene = fakeScene();
  const history = new History(scene.target);
  scene.target.create(snapshot('clay-5'));

  for (let i = 1; i <= 5; i += 1) {
    history.push({
      type: 'transform',
      id: 'clay-5',
      before: transform(i - 1),
      after: transform(i),
    });
  }

  for (let i = 0; i < 5; i += 1) history.undo();
  assert.deepEqual(scene.live.get('clay-5')?.position, [0, 0, 0]);

  for (let i = 0; i < 5; i += 1) history.redo();
  assert.deepEqual(scene.live.get('clay-5')?.position, [5, 0, 0]);
});

test('transform comparison tolerates float noise but not real movement', () => {
  assert.ok(transformsEqual(transform(0.1), transform(0.1 + 1e-9)));
  assert.ok(!transformsEqual(transform(0.1), transform(0.11)));
  assert.ok(!transformsEqual(transform(0.1, 1), transform(0.1, 1.5)));
});

test('cloneTransform copies rather than aliases', () => {
  const original = transform(0.3);
  const copy = cloneTransform(original);
  copy.position[0] = 99;
  assert.equal(original.position[0], 0.3);
});
