import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  KNOCKDOWN_SECONDS,
  MAX_HEALTH,
  Match,
  ROUNDS_TO_WIN,
  ROUND_SECONDS,
} from '../src/game/match.js';

function run(match: Match, seconds: number): void {
  const dt = 1 / 60;
  for (let i = 0; i < Math.round(seconds / dt); i += 1) match.update(dt);
}

test('nothing happens until the match starts', () => {
  const match = new Match();
  assert.equal(match.state.phase, 'ready');

  match.damage('them', 50);
  assert.equal(match.state.health.them, MAX_HEALTH, 'took damage before the bell');

  run(match, 5);
  assert.equal(match.state.timeLeft, ROUND_SECONDS, 'clock ran before the bell');
});

test('damage lands and the clock runs once it starts', () => {
  const match = new Match();
  match.start();

  match.damage('them', 30);
  assert.equal(match.state.health.them, MAX_HEALTH - 30);

  run(match, 2);
  assert.ok(match.state.timeLeft < ROUND_SECONDS);
});

test('dropping someone to zero wins the round, not the match', () => {
  const match = new Match();
  match.start();

  match.damage('them', MAX_HEALTH);
  assert.equal(match.state.phase, 'knockdown');
  assert.equal(match.state.lastRoundWinner, 'you');
  assert.equal(match.state.rounds.you, 1);
  assert.equal(match.state.winner, null);
});

test('health cannot go negative', () => {
  const match = new Match();
  match.start();
  match.damage('you', MAX_HEALTH * 4);
  assert.equal(match.state.health.you, 0);
});

test('the knockdown pause ends and the next round starts fresh', () => {
  const match = new Match();
  match.start();
  match.damage('them', MAX_HEALTH);

  run(match, KNOCKDOWN_SECONDS + 0.2);
  assert.equal(match.state.phase, 'fighting');
  assert.equal(match.state.round, 2);
  assert.equal(match.state.health.you, MAX_HEALTH);
  assert.equal(match.state.health.them, MAX_HEALTH);
  // The new round's clock is already running — we ran 0.2s past the pause.
  assert.ok(match.state.timeLeft > ROUND_SECONDS - 0.5, `clock at ${match.state.timeLeft}`);
  assert.ok(match.state.timeLeft <= ROUND_SECONDS);
});

test('no damage lands during the knockdown pause', () => {
  const match = new Match();
  match.start();
  match.damage('them', MAX_HEALTH);

  match.damage('you', 40);
  assert.equal(match.state.health.you, MAX_HEALTH);
});

test('taking enough rounds wins the match and stops the clock', () => {
  const match = new Match();
  match.start();

  for (let i = 0; i < ROUNDS_TO_WIN; i += 1) {
    match.damage('them', MAX_HEALTH);
    if (match.state.phase === 'knockdown') run(match, KNOCKDOWN_SECONDS + 0.2);
  }

  assert.equal(match.state.phase, 'over');
  assert.equal(match.state.winner, 'you');

  // And it stays over.
  run(match, 10);
  assert.equal(match.state.phase, 'over');
  match.damage('you', 50);
  assert.equal(match.state.health.you, MAX_HEALTH);
});

test('running out of time gives the round to whoever is ahead', () => {
  const match = new Match();
  match.start();
  match.damage('you', 40);

  run(match, ROUND_SECONDS + 1);
  assert.equal(match.state.lastRoundWinner, 'them');
  assert.equal(match.state.rounds.them, 1);
});

test('a dead-even round goes to nobody but still moves on', () => {
  const match = new Match();
  match.start();
  match.damage('you', 25);
  match.damage('them', 25);

  run(match, ROUND_SECONDS + 1);
  assert.equal(match.state.lastRoundWinner, null);
  assert.equal(match.state.rounds.you, 0);
  assert.equal(match.state.rounds.them, 0);

  run(match, KNOCKDOWN_SECONDS + 0.2);
  assert.equal(match.state.phase, 'fighting');
});

test('a stalled tab cannot skip the round or the pause', () => {
  const match = new Match();
  match.start();

  // Five seconds handed back in one frame.
  match.update(5);
  assert.ok(match.state.timeLeft > ROUND_SECONDS - 1, `clock jumped to ${match.state.timeLeft}`);

  match.damage('them', MAX_HEALTH);
  match.update(5);
  assert.equal(match.state.phase, 'knockdown', 'skipped the whole knockdown in one frame');
});

test('reset returns it to before the bell', () => {
  const match = new Match();
  match.start();
  match.damage('them', 60);
  match.reset();

  assert.equal(match.state.phase, 'ready');
  assert.equal(match.state.health.them, MAX_HEALTH);
  assert.equal(match.state.rounds.you, 0);
  assert.equal(match.state.round, 1);
});
