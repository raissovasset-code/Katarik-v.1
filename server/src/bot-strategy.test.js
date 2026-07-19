import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseBotAction, generateBotMoves } from './bot-strategy.js';

function card(id, rank, type = 'normal', suit = 'S') {
  return { id, rank, type, suit: type === 'normal' ? suit : null };
}

function gameWith(hand, table = null, opponentCards = 6) {
  return {
    mode: 'classic',
    status: 'playing',
    currentPlayerId: 'bot',
    pogonReadyPlayerId: null,
    table,
    players: [
      { id: 'bot', isBot: true, active: true, hand, pogonRank: '4' },
      { id: 'human', active: true, hand: Array.from({ length: opponentCards }, (_, i) => ({ id: `x${i}` })) },
    ],
  };
}

test('generates groups, straights and double straights without brute force', () => {
  const hand = [
    card('4S', '4'), card('4H', '4', 'normal', 'H'),
    card('5S', '5'), card('5H', '5', 'normal', 'H'),
    card('6S', '6'), card('6H', '6', 'normal', 'H'),
    card('7S', '7'),
  ];
  const types = new Set(generateBotMoves(gameWith(hand), gameWith(hand).players[0]).map(move => move.combo.type));

  assert.equal(types.has('pair'), true);
  assert.equal(types.has('straight'), true);
  assert.equal(types.has('doubleStraight'), true);
});

test('prefers shedding a long combination on a free table', () => {
  const hand = [card('4S', '4'), card('5S', '5'), card('6S', '6'), card('7S', '7'), card('AS', 'A')];
  const action = chooseBotAction(gameWith(hand), 'bot');

  assert.equal(action.type, 'play');
  assert.deepEqual(new Set(action.cardIds), new Set(['4S', '5S', '6S', '7S']));
});

test('strategically passes instead of wasting a bomb when there is no threat', () => {
  const hand = [
    card('9S', '9'), card('9H', '9', 'normal', 'H'),
    card('9D', '9', 'normal', 'D'), card('9C', '9', 'normal', 'C'),
    card('4S', '4'), card('5S', '5'),
  ];
  const table = { combo: { type: 'triple', high: 13, length: 3 } };

  assert.deepEqual(chooseBotAction(gameWith(hand, table), 'bot'), { type: 'pass' });
});

test('uses a bomb when an opponent is about to finish', () => {
  const hand = [
    card('9S', '9'), card('9H', '9', 'normal', 'H'),
    card('9D', '9', 'normal', 'D'), card('9C', '9', 'normal', 'C'),
    card('4S', '4'),
  ];
  const table = { combo: { type: 'triple', high: 13, length: 3 } };
  const action = chooseBotAction(gameWith(hand, table, 1), 'bot');

  assert.equal(action.type, 'play');
  assert.equal(action.cardIds.length, 4);
});

test('prioritizes a finishing pogon move', () => {
  const hand = [card('4S', '4'), card('4H', '4', 'normal', 'H')];
  const game = gameWith(hand);
  game.mode = 'pogoni';
  game.pogonReadyPlayerId = 'bot';
  const action = chooseBotAction(game, 'bot');

  assert.equal(action.type, 'play');
  assert.deepEqual(new Set(action.cardIds), new Set(['4S', '4H']));
});

test('preserves the current pogon rank until the bot can actually set a pogon', () => {
  const hand = [card('4D', '4', 'normal', 'D'), card('7H', '7', 'normal', 'H')];
  const game = gameWith(hand);
  game.mode = 'pogoni';
  game.pogonReadyPlayerId = null;

  const action = chooseBotAction(game, 'bot');

  assert.equal(action.type, 'play');
  assert.deepEqual(action.cardIds, ['7H']);
});

test('does not empty its hand with the current pogon rank before a captured-table turn', () => {
  const hand = [card('7D', '7', 'normal', 'D')];
  const table = {
    cards: [card('6S', '6')],
    combo: { type: 'single', high: 3, length: 1 },
  };
  const game = gameWith(hand, table);
  game.mode = 'pogoni';
  game.pogonReadyPlayerId = null;
  game.players[0].pogonRank = '7';

  assert.deepEqual(chooseBotAction(game, 'bot'), { type: 'pass' });
});

test('passes instead of playing the protected pogon rank before capturing the table', () => {
  const hand = [card('7D', '7', 'normal', 'D'), card('4S', '4')];
  const table = {
    cards: [card('6S', '6')],
    combo: { type: 'single', high: 3, length: 1 },
  };
  const game = gameWith(hand, table);
  game.mode = 'pogoni';
  game.players[0].pogonRank = '7';

  assert.deepEqual(chooseBotAction(game, 'bot'), { type: 'pass' });
});

test('never spends the protected pogon rank when another legal move exists', () => {
  const hand = [
    card('7S', '7'), card('7H', '7', 'normal', 'H'),
    card('7D', '7', 'normal', 'D'), card('7C', '7', 'normal', 'C'),
    card('8S', '8'),
  ];
  const table = {
    cards: [card('6S', '6')],
    combo: { type: 'single', high: 3, length: 1 },
  };
  const game = gameWith(hand, table);
  game.mode = 'pogoni';
  game.players[0].pogonRank = '7';

  assert.deepEqual(chooseBotAction(game, 'bot').cardIds, ['8S']);
});

test('uses a strong combination to capture the table and leave a finishing pogon tail', () => {
  const hand = [
    card('9S', '9'), card('9H', '9', 'normal', 'H'),
    card('9D', '9', 'normal', 'D'), card('9C', '9', 'normal', 'C'),
    card('4S', '4'), card('4H', '4', 'normal', 'H'),
  ];
  const table = {
    cards: [card('KS', 'K'), card('KH', 'K', 'normal', 'H'), card('KD', 'K', 'normal', 'D')],
    combo: { type: 'triple', high: 10, length: 3 },
  };
  const game = gameWith(hand, table);
  game.mode = 'pogoni';

  const capture = chooseBotAction(game, 'bot');
  assert.equal(capture.type, 'play');
  assert.deepEqual(new Set(capture.cardIds), new Set(['9S', '9H', '9D', '9C']));

  game.players[0].hand = [card('4S', '4'), card('4H', '4', 'normal', 'H')];
  game.table = null;
  game.pogonReadyPlayerId = 'bot';
  const pogon = chooseBotAction(game, 'bot');
  assert.deepEqual(new Set(pogon.cardIds), new Set(['4S', '4H']));
});
