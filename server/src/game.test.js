import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addPlayer,
  canBeat,
  createGame,
  detectBestCombination,
  nextRound,
  pass,
  playCards,
  startGame,
} from './game.js';

function makeCard(id, rank, suit = 'S') {
  return { id, rank, suit, type: 'normal' };
}

function makeDvk() {
  return { id: 'DVK', rank: 'DVK', suit: null, type: 'wild' };
}

function makeJoker(id, rank) {
  return { id, rank, suit: null, type: 'joker' };
}

function makeGame(mode = 'classic', playerIds = ['A', 'B', 'C']) {
  const game = createGame('TEST', mode);
  playerIds.forEach(id => addPlayer(game, { id, name: id }));
  game.status = 'playing';
  game.currentPlayerId = playerIds[0];
  game.roundStarterId = playerIds[0];
  return game;
}

function player(game, playerId) {
  return game.players.find(item => item.id === playerId);
}

test('startGame creates a playable room state', () => {
  const game = createGame('ROOM', 'pogoni');
  addPlayer(game, { id: 'A', name: 'Aset' });
  addPlayer(game, { id: 'B', name: 'Player' });

  startGame(game);

  assert.equal(game.status, 'playing');
  assert.ok(game.currentPlayerId);
  assert.equal(game.players.length, 2);
  assert.ok(player(game, 'A').hand.length > 0);
  assert.ok(player(game, 'B').hand.length > 0);
});

test('players with the same requested name receive unique display names', () => {
  const game = createGame('ROOM', 'classic');
  addPlayer(game, { id: 'A', name: 'Асет' });
  addPlayer(game, { id: 'B', name: 'Асет' });
  addPlayer(game, { id: 'C', name: 'Асет' });

  assert.deepEqual(game.players.map(item => item.name), ['Асет', 'Асет 2', 'Асет 3']);
});

test('one card cannot be played twice in the same move', () => {
  const game = makeGame('classic', ['A', 'B']);
  player(game, 'A').hand = [makeCard('4S', '4')];

  assert.throws(() => playCards(game, 'A', ['4S', '4S']));
});

test('detects base combinations', () => {
  assert.equal(detectBestCombination([makeCard('4S', '4')]).type, 'single');

  const pair = detectBestCombination([makeCard('5S', '5'), makeCard('5H', '5')]);
  assert.equal(pair.type, 'pair');

  const triple = detectBestCombination([
    makeCard('6S', '6'),
    makeCard('6H', '6'),
    makeCard('6D', '6'),
  ]);
  assert.equal(triple.type, 'triple');

  const quad = detectBestCombination([
    makeCard('7S', '7'),
    makeCard('7H', '7'),
    makeCard('7D', '7'),
    makeCard('7C', '7'),
  ]);
  assert.equal(quad.type, 'quad');
});

test('detects katarik and bomb combinations', () => {
  const straight = detectBestCombination([
    makeCard('4S', '4'),
    makeCard('5H', '5'),
    makeCard('6D', '6'),
    makeCard('7C', '7'),
    makeCard('8S', '8'),
  ]);

  assert.equal(straight.type, 'straight');
  assert.equal(straight.length, 5);

  const doubleStraight = detectBestCombination([
    makeCard('4S', '4'),
    makeCard('4H', '4'),
    makeCard('5S', '5'),
    makeCard('5H', '5'),
    makeCard('6S', '6'),
    makeCard('6H', '6'),
  ]);

  assert.equal(doubleStraight.type, 'doubleStraight');
  assert.equal(doubleStraight.length, 3);
});

test('DVK can complete regular groups and katarik', () => {
  const pair = detectBestCombination([makeCard('9S', '9'), makeDvk()]);
  assert.equal(pair.type, 'pair');

  const straight = detectBestCombination([
    makeCard('4S', '4'),
    makeCard('5H', '5'),
    makeDvk(),
    makeCard('7C', '7'),
    makeCard('8S', '8'),
  ]);

  assert.equal(straight.type, 'straight');
  assert.equal(straight.length, 5);
});

test('jokers are only single cards and cannot join groups', () => {
  const redJoker = makeJoker('RED_JOKER', 'RED_JOKER');

  assert.equal(detectBestCombination([redJoker]).type, 'single');
  assert.equal(detectBestCombination([redJoker, makeCard('AS', 'A')]), null);
});

test('combination beating rules stay stable', () => {
  const singleFive = detectBestCombination([makeCard('5S', '5')]);
  const singleSix = detectBestCombination([makeCard('6S', '6')]);
  const pairFive = detectBestCombination([makeCard('5S', '5'), makeCard('5H', '5')]);
  const pairSix = detectBestCombination([makeCard('6S', '6'), makeCard('6H', '6')]);
  const tripleFour = detectBestCombination([
    makeCard('4S', '4'),
    makeCard('4H', '4'),
    makeCard('4D', '4'),
  ]);
  const quadFour = detectBestCombination([
    makeCard('4S', '4'),
    makeCard('4H', '4'),
    makeCard('4D', '4'),
    makeCard('4C', '4'),
  ]);
  const redJoker = detectBestCombination([makeJoker('RED_JOKER', 'RED_JOKER')]);

  assert.equal(canBeat(singleFive, singleSix), true);
  assert.equal(canBeat(singleSix, singleFive), false);
  assert.equal(canBeat(pairFive, pairSix), true);
  assert.equal(canBeat(pairSix, singleSix), false);
  assert.equal(canBeat(singleSix, tripleFour), true);
  assert.equal(canBeat(redJoker, singleSix), false);
  assert.equal(canBeat(redJoker, quadFour), true);
});

test('turn moves clockwise after a valid move', () => {
  const game = makeGame('classic', ['A', 'B', 'C']);
  player(game, 'A').hand = [makeCard('4S', '4'), makeCard('9S', '9')];
  player(game, 'B').hand = [makeCard('5S', '5')];
  player(game, 'C').hand = [makeCard('6S', '6')];

  playCards(game, 'A', ['4S']);

  assert.equal(game.currentPlayerId, 'B');
});

test('all other players passing gives the turn back to the table winner', () => {
  const game = makeGame('pogoni', ['A', 'B', 'C']);
  player(game, 'A').hand = [makeCard('6S', '6'), makeCard('4S', '4')];
  player(game, 'B').hand = [makeCard('5S', '5')];
  player(game, 'C').hand = [makeCard('7S', '7')];

  playCards(game, 'A', ['6S']);
  pass(game, 'B');
  pass(game, 'C');

  assert.equal(game.currentPlayerId, 'A');
  assert.equal(game.pogonReadyPlayerId, 'A');
});

test('pogon is counted only after a player captured the table', () => {
  const game = makeGame('pogoni', ['A', 'B', 'C']);
  player(game, 'A').hand = [makeCard('6S', '6'), makeCard('4S', '4')];
  player(game, 'B').hand = [makeCard('5S', '5')];
  player(game, 'C').hand = [makeCard('7S', '7')];

  playCards(game, 'A', ['6S']);
  pass(game, 'B');
  pass(game, 'C');
  playCards(game, 'A', ['4S']);

  assert.equal(player(game, 'A').pogonRank, '5');
  assert.equal(game.status, 'round_finished');
  assert.equal(game.roundWinnerId, 'A');
});

test('free turn after the previous player exited does not count as pogon-ready', () => {
  const game = makeGame('pogoni', ['A', 'B', 'C']);
  player(game, 'A').hand = [makeCard('6S', '6')];
  player(game, 'B').hand = [makeCard('4S', '4'), makeCard('5S', '5')];
  player(game, 'C').hand = [makeCard('7S', '7'), makeCard('8S', '8')];

  playCards(game, 'A', ['6S']);
  pass(game, 'B');
  pass(game, 'C');

  assert.equal(game.currentPlayerId, 'B');
  assert.equal(game.pogonReadyPlayerId, null);

  playCards(game, 'B', ['4S']);

  assert.equal(player(game, 'B').pogonRank, '4');
});

test('in pogoni, the first player who exited starts the next round', () => {
  const game = makeGame('pogoni', ['A', 'B', 'C']);
  player(game, 'A').hand = [makeCard('6S', '6')];
  player(game, 'B').hand = [makeCard('7S', '7'), makeCard('4S', '4')];
  player(game, 'C').hand = [makeCard('8S', '8')];

  playCards(game, 'A', ['6S']);
  pass(game, 'B');
  pass(game, 'C');
  playCards(game, 'B', ['7S']);
  pass(game, 'C');
  playCards(game, 'B', ['4S']);

  assert.equal(game.status, 'round_finished');
  assert.equal(game.roundWinnerId, 'A');

  nextRound(game);

  assert.equal(game.status, 'playing');
  assert.equal(game.currentPlayerId, 'A');
});
