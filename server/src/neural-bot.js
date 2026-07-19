import fs from 'node:fs';
import { generateBotMoves } from './bot-strategy.js';

const RANKS = ['4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2', '3'];
const COMBOS = ['single', 'pair', 'triple', 'quad', 'straight', 'doubleStraight'];

function oneHot(value, values) {
  return values.map(item => Number(item === value));
}

export function legalNeuralActions(game, playerId) {
  const player = game.players.find(item => item.id === playerId);
  if (!player) return [];
  if (player.hand.length === 1 && player.hand[0]?.type === 'wild') {
    return [{ type: 'play', cardIds: [], declaredRanks: {}, combo: null, cards: [] }];
  }
  const moves = generateBotMoves(game, player).map(move => ({ type: 'play', ...move }));
  if (game.table) moves.push({ type: 'pass', cardIds: [], declaredRanks: {}, combo: null, cards: [] });
  return moves;
}

export function encodeStateAction(game, playerId, action) {
  const player = game.players.find(item => item.id === playerId);
  const opponents = game.players.filter(item => item.id !== playerId && item.active);
  const counts = Object.fromEntries(RANKS.map(rank => [rank, 0]));
  for (const card of player.hand) if (card.type === 'normal') counts[card.rank] += 1;
  const opponentHands = opponents.map(item => item.hand.length);
  const combo = action.combo || null;
  const cards = action.cards || [];
  const remaining = player.hand.length - action.cardIds.length;

  return [
    ...oneHot(game.mode, ['classic', 'elimination', 'pogoni']),
    ...RANKS.map(rank => counts[rank] / 4),
    player.hand.filter(card => card.type === 'joker').length / 2,
    Number(player.hand.some(card => card.type === 'wild')),
    Number(Boolean(game.table)),
    ...oneHot(game.table?.combo?.type, COMBOS),
    (game.table?.combo?.high || 0) / 15,
    (game.table?.combo?.length || 0) / 11,
    (opponentHands.length ? Math.min(...opponentHands) : 0) / 28,
    (opponentHands.reduce((sum, value) => sum + value, 0) / Math.max(opponentHands.length, 1)) / 28,
    opponents.length / 10,
    game.passedPlayerIds.length / Math.max(game.players.length, 1),
    RANKS.indexOf(player.pogonRank) / 10,
    Number(game.pogonReadyPlayerId === playerId),
    Number(action.type === 'pass'),
    ...oneHot(combo?.type, COMBOS),
    (combo?.high || 0) / 15,
    (combo?.length || 0) / 11,
    action.cardIds.length / Math.max(player.hand.length, 1),
    Number(cards.some(card => card.type === 'joker')),
    Number(cards.some(card => card.type === 'wild')),
    Number(cards.some(card => card.type === 'normal' && card.rank === player.pogonRank)),
    Number(remaining === 0),
  ];
}

export const NEURAL_INPUT_SIZE = encodeStateAction({
  mode: 'classic', table: null, passedPlayerIds: [], pogonReadyPlayerId: null,
  players: [{ id: 'x', active: true, hand: [], pogonRank: '4' }, { id: 'y', active: true, hand: [] }],
}, 'x', { type: 'pass', cardIds: [], cards: [], combo: null }).length;

export function loadPublishedNeuralModel() {
  try {
    const model = JSON.parse(
      fs.readFileSync(new URL('./neural-bot-model.json', import.meta.url), 'utf8'),
    );
    if (model.inputSize !== NEURAL_INPUT_SIZE || !model.metadata?.accepted) return null;
    return model;
  } catch {
    return null;
  }
}

export const PUBLISHED_NEURAL_MODEL = loadPublishedNeuralModel();

export function createNeuralModel({ inputSize = NEURAL_INPUT_SIZE, hiddenSize = 32, random = Math.random } = {}) {
  const scale = Math.sqrt(2 / inputSize);
  return {
    version: 1,
    inputSize,
    hiddenSize,
    weights1: Array.from({ length: hiddenSize }, () =>
      Array.from({ length: inputSize }, () => (random() * 2 - 1) * scale)),
    bias1: Array(hiddenSize).fill(0),
    weights2: Array.from({ length: hiddenSize }, () => (random() * 2 - 1) / Math.sqrt(hiddenSize)),
    bias2: 0,
  };
}

export function neuralScore(model, input) {
  if (input.length !== model.inputSize) throw new Error('Neural input size mismatch');
  const hidden = model.weights1.map((row, index) => Math.max(
    0,
    row.reduce((sum, weight, inputIndex) => sum + weight * input[inputIndex], model.bias1[index]),
  ));
  return hidden.reduce((sum, value, index) => sum + value * model.weights2[index], model.bias2);
}

export function trainNeuralChoice(
  model,
  inputs,
  chosenIndex,
  learningRate = 0.01,
  advantage = 1,
) {
  if (inputs.length < 2) return { loss: 0, correct: true };
  const caches = inputs.map(input => {
    const pre = model.weights1.map((row, index) =>
      row.reduce((sum, weight, inputIndex) => sum + weight * input[inputIndex], model.bias1[index]));
    const hidden = pre.map(value => Math.max(0, value));
    const score = hidden.reduce((sum, value, index) => sum + value * model.weights2[index], model.bias2);
    return { input, pre, hidden, score };
  });
  const max = Math.max(...caches.map(cache => cache.score));
  const exps = caches.map(cache => Math.exp(cache.score - max));
  const total = exps.reduce((sum, value) => sum + value, 0);
  const probabilities = exps.map(value => value / total);
  const gradW1 = model.weights1.map(row => row.map(() => 0));
  const gradB1 = model.bias1.map(() => 0);
  const gradW2 = model.weights2.map(() => 0);
  let gradB2 = 0;

  caches.forEach((cache, actionIndex) => {
    const outputGradient = (
      probabilities[actionIndex] - Number(actionIndex === chosenIndex)
    ) * advantage;
    gradB2 += outputGradient;
    cache.hidden.forEach((value, hiddenIndex) => {
      gradW2[hiddenIndex] += outputGradient * value;
      const hiddenGradient = outputGradient * model.weights2[hiddenIndex] * Number(cache.pre[hiddenIndex] > 0);
      gradB1[hiddenIndex] += hiddenGradient;
      cache.input.forEach((inputValue, inputIndex) => {
        gradW1[hiddenIndex][inputIndex] += hiddenGradient * inputValue;
      });
    });
  });

  model.bias2 -= learningRate * gradB2;
  model.weights2.forEach((_, index) => { model.weights2[index] -= learningRate * gradW2[index]; });
  model.bias1.forEach((_, hiddenIndex) => {
    model.bias1[hiddenIndex] -= learningRate * gradB1[hiddenIndex];
    model.weights1[hiddenIndex].forEach((__, inputIndex) => {
      model.weights1[hiddenIndex][inputIndex] -= learningRate * gradW1[hiddenIndex][inputIndex];
    });
  });

  const predicted = probabilities.indexOf(Math.max(...probabilities));
  return { loss: -Math.log(Math.max(probabilities[chosenIndex], 1e-12)), correct: predicted === chosenIndex };
}

export function sampleNeuralAction(
  game,
  playerId,
  model,
  { random = Math.random, temperature = 1 } = {},
) {
  const actions = legalNeuralActions(game, playerId);
  if (!actions.length) return null;
  const inputs = actions.map(action => encodeStateAction(game, playerId, action));
  const scores = inputs.map(input => neuralScore(model, input) / Math.max(temperature, 0.05));
  const max = Math.max(...scores);
  const exps = scores.map(score => Math.exp(score - max));
  const total = exps.reduce((sum, value) => sum + value, 0);
  const probabilities = exps.map(value => value / total);
  let threshold = random();
  let chosenIndex = probabilities.length - 1;
  for (let index = 0; index < probabilities.length; index += 1) {
    threshold -= probabilities[index];
    if (threshold <= 0) {
      chosenIndex = index;
      break;
    }
  }
  return {
    action: actions[chosenIndex],
    inputs,
    chosenIndex,
    probability: probabilities[chosenIndex],
  };
}

function sameAction(left, right) {
  if (left.type !== right.type) return false;
  return left.type === 'pass'
    || left.cardIds.length === right.cardIds.length
      && left.cardIds.every(id => right.cardIds.includes(id));
}

export function neuralTrainingExample(game, playerId, teacherAction) {
  const actions = legalNeuralActions(game, playerId);
  const chosenIndex = actions.findIndex(action => sameAction(action, teacherAction));
  if (chosenIndex < 0) return null;
  return {
    actions,
    inputs: actions.map(action => encodeStateAction(game, playerId, action)),
    chosenIndex,
  };
}

export function chooseNeuralAction(game, playerId, model) {
  const actions = legalNeuralActions(game, playerId);
  if (!actions.length) return null;
  return actions
    .map(action => ({ action, score: neuralScore(model, encodeStateAction(game, playerId, action)) }))
    .sort((left, right) => right.score - left.score)[0].action;
}
