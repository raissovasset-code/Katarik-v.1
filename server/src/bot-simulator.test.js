import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_BOT_WEIGHTS } from './bot-strategy.js';
import { createSeededRandom, evaluateWeights, simulateBotGame } from './bot-simulator.js';

test('seeded random produces a reproducible sequence', () => {
  const first = createSeededRandom(42);
  const second = createSeededRandom(42);
  assert.deepEqual(
    Array.from({ length: 5 }, () => first()),
    Array.from({ length: 5 }, () => second()),
  );
});

test('the same simulated classic game is reproducible', () => {
  const options = { seed: 77, playerWeights: [DEFAULT_BOT_WEIGHTS, DEFAULT_BOT_WEIGHTS] };
  assert.deepEqual(simulateBotGame(options), simulateBotGame(options));
});

test('simulator completes all game modes', () => {
  for (const mode of ['classic', 'elimination', 'pogoni']) {
    const count = mode === 'elimination' ? 3 : 2;
    const result = simulateBotGame({
      mode,
      seed: 19,
      playerWeights: Array.from({ length: count }, () => DEFAULT_BOT_WEIGHTS),
    });
    assert.equal(result.completed, true, mode);
    assert.match(result.winnerId, /^bot-/);
  }
});

test('weight evaluation alternates seats and reports every game', () => {
  const result = evaluateWeights({
    candidate: DEFAULT_BOT_WEIGHTS,
    baseline: DEFAULT_BOT_WEIGHTS,
    games: 6,
    seed: 300,
  });
  assert.equal(result.wins + result.losses + result.incomplete, 6);
  assert.equal(result.incomplete, 0);
  assert.equal(result.winRate, 0.5);
});
