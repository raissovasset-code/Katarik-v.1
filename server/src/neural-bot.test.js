import assert from 'node:assert/strict';
import test from 'node:test';

import { addPlayer, createGame, startGame } from './game.js';
import { createSeededRandom } from './bot-simulator.js';
import {
  chooseNeuralAction,
  createNeuralModel,
  encodeStateAction,
  legalNeuralActions,
  neuralScore,
  sampleNeuralAction,
  trainNeuralChoice,
} from './neural-bot.js';

function startedGame(seed = 1) {
  const original = Math.random;
  Math.random = createSeededRandom(seed);
  try {
    const game = createGame('NEURAL', 'classic');
    addPlayer(game, { id: 'A', name: 'A', isBot: true });
    addPlayer(game, { id: 'B', name: 'B', isBot: true });
    startGame(game);
    return game;
  } finally {
    Math.random = original;
  }
}

test('encoder does not inspect opponent card identities', () => {
  const game = startedGame(20);
  const playerId = game.currentPlayerId;
  const action = legalNeuralActions(game, playerId)[0];
  const before = encodeStateAction(game, playerId, action);
  const opponent = game.players.find(player => player.id !== playerId);
  opponent.hand = opponent.hand.map((card, index) => ({ ...card, id: `SECRET-${index}`, rank: 'A' }));
  assert.deepEqual(encodeStateAction(game, playerId, action), before);
});

test('neural training raises the chosen action score', () => {
  const model = createNeuralModel({ inputSize: 3, hiddenSize: 6, random: createSeededRandom(4) });
  const inputs = [[1, 0, 0], [0, 1, 0]];
  const before = neuralScore(model, inputs[0]) - neuralScore(model, inputs[1]);
  for (let index = 0; index < 100; index += 1) trainNeuralChoice(model, inputs, 0, 0.03);
  const after = neuralScore(model, inputs[0]) - neuralScore(model, inputs[1]);
  assert.ok(after > before);
  assert.ok(after > 0);
});

test('neural policy always returns a generated legal action', () => {
  const game = startedGame(40);
  const playerId = game.currentPlayerId;
  const model = createNeuralModel({ random: createSeededRandom(5) });
  const legal = legalNeuralActions(game, playerId);
  const selected = chooseNeuralAction(game, playerId, model);
  assert.ok(legal.some(action => action.type === selected.type
    && action.cardIds.length === selected.cardIds.length
    && action.cardIds.every(id => selected.cardIds.includes(id))));
});

test('positive and negative rewards move a sampled action in opposite directions', () => {
  const inputs = [[1, 0, 0], [0, 1, 0]];
  const rewarded = createNeuralModel({ inputSize: 3, hiddenSize: 6, random: createSeededRandom(8) });
  const punished = structuredClone(rewarded);
  const initial = neuralScore(rewarded, inputs[0]) - neuralScore(rewarded, inputs[1]);
  for (let index = 0; index < 50; index += 1) {
    trainNeuralChoice(rewarded, inputs, 0, 0.02, 1);
    trainNeuralChoice(punished, inputs, 0, 0.02, -1);
  }
  assert.ok(neuralScore(rewarded, inputs[0]) - neuralScore(rewarded, inputs[1]) > initial);
  assert.ok(neuralScore(punished, inputs[0]) - neuralScore(punished, inputs[1]) < initial);
});

test('sampled neural action is reproducible with seeded exploration', () => {
  const game = startedGame(50);
  const playerId = game.currentPlayerId;
  const model = createNeuralModel({ random: createSeededRandom(9) });
  const first = sampleNeuralAction(game, playerId, model, { random: createSeededRandom(10) });
  const second = sampleNeuralAction(game, playerId, model, { random: createSeededRandom(10) });
  assert.equal(first.chosenIndex, second.chosenIndex);
  assert.deepEqual(first.action.cardIds, second.action.cardIds);
});
