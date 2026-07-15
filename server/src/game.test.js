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
  removePlayer,
  restartGame,
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

test('deal extra cards rotates around the table each round', () => {
  const game = createGame('ROOM', 'pogoni');
  ['A', 'B', 'C', 'D'].forEach(id => addPlayer(game, { id, name: id }));

  startGame(game);

  assert.deepEqual(game.players.map(item => item.hand.length), [14, 14, 14, 13]);

  game.status = 'round_finished';
  game.roundWinnerId = 'A';
  nextRound(game);

  assert.deepEqual(game.players.map(item => item.hand.length), [13, 14, 14, 14]);

  game.status = 'round_finished';
  game.roundWinnerId = 'A';
  nextRound(game);

  assert.deepEqual(game.players.map(item => item.hand.length), [14, 13, 14, 14]);
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

test('a move cannot leave DVK as the only card', () => {
  const game = makeGame('classic', ['A', 'B']);
  player(game, 'A').hand = [makeCard('4S', '4'), makeDvk()];

  assert.throws(() => playCards(game, 'A', ['4S']), /ДВК/);
  assert.deepEqual(player(game, 'A').hand.map(card => card.id), ['4S', 'DVK']);
  assert.equal(game.table, null);
  assert.equal(game.currentPlayerId, 'A');
});

test('a move cannot leave DVK with only jokers', () => {
  const game = makeGame('classic', ['A', 'B']);
  player(game, 'A').hand = [
    makeCard('4S', '4'),
    makeDvk(),
    makeJoker('RED_JOKER', 'RED_JOKER'),
    makeJoker('BLACK_JOKER', 'BLACK_JOKER'),
  ];

  assert.throws(() => playCards(game, 'A', ['4S']), /ДВК/);
  assert.equal(player(game, 'A').hand.length, 4);
  assert.equal(game.table, null);
  assert.equal(game.currentPlayerId, 'A');
});

test('DVK may remain when the hand still has a normal card', () => {
  const game = makeGame('classic', ['A', 'B']);
  player(game, 'A').hand = [
    makeCard('4S', '4'),
    makeCard('5S', '5'),
    makeDvk(),
    makeJoker('RED_JOKER', 'RED_JOKER'),
  ];

  playCards(game, 'A', ['4S']);

  assert.deepEqual(player(game, 'A').hand.map(card => card.id), ['5S', 'DVK', 'RED_JOKER']);
  assert.equal(game.currentPlayerId, 'B');
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

test('pogon with DVK advances only by matching normal cards', () => {
  const game = makeGame('pogoni', ['A', 'B', 'C']);
  player(game, 'A').hand = [makeCard('6S', '6'), makeCard('4S', '4'), makeCard('4H', '4', 'H'), makeDvk()];
  player(game, 'B').hand = [makeCard('5S', '5')];
  player(game, 'C').hand = [makeCard('7S', '7')];

  playCards(game, 'A', ['6S']);
  pass(game, 'B');
  pass(game, 'C');
  playCards(game, 'A', ['4S', '4H', 'DVK']);

  assert.equal(player(game, 'A').pogonRank, '6');
  assert.equal(game.status, 'round_finished');
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

test('leaving a classic game ends it and makes the leaver the loser', () => {
  const game = makeGame('classic', ['A', 'B', 'C']);

  removePlayer(game, 'B');

  assert.equal(game.status, 'finished');
  assert.equal(game.currentPlayerId, null);
  assert.equal(game.loserId, 'B');
  assert.equal(player(game, 'B').leaving, true);
  assert.equal(player(game, 'B').active, false);
  assert.deepEqual(game.players.map(item => item.id), ['A', 'B', 'C']);
});

test('leaving an elimination game ends the round and eliminates the leaver', () => {
  const game = makeGame('elimination', ['A', 'B', 'C']);

  removePlayer(game, 'B');

  assert.equal(game.status, 'round_finished');
  assert.equal(game.loserId, 'B');
  assert.equal(player(game, 'B').leaving, true);
  assert.ok(game.eliminatedIds.includes('B'));

  nextRound(game);

  assert.deepEqual(game.players.map(item => item.id), ['A', 'C']);
  assert.equal(game.status, 'playing');
});

test('with two pogoni players, the leaving player loses immediately', () => {
  const game = makeGame('pogoni', ['A', 'B']);

  removePlayer(game, 'B');

  assert.equal(game.status, 'finished');
  assert.equal(game.roundWinnerId, 'A');
  assert.equal(game.loserId, 'B');
  assert.equal(player(game, 'B').leaving, true);
});

test('a waiting leaver stays gray until the end of a pogoni round', () => {
  const game = makeGame('pogoni', ['A', 'B', 'C', 'D']);
  game.currentPlayerId = 'A';

  removePlayer(game, 'C');

  assert.deepEqual(game.players.map(item => item.id), ['A', 'B', 'C', 'D']);
  assert.equal(player(game, 'C').leaving, true);
  assert.equal(player(game, 'C').active, true);
  assert.equal(game.currentPlayerId, 'A');
  assert.equal(game.status, 'playing');
});

test('a pogoni leaver automatically passes when a table is active', () => {
  const game = makeGame('pogoni', ['A', 'B', 'C', 'D']);
  game.currentPlayerId = 'B';
  game.lastPlayedPlayerId = 'A';
  game.table = {
    playerId: 'A',
    cards: [makeCard('4S', '4')],
    combo: { type: 'single', high: 1, length: 1 },
  };

  removePlayer(game, 'B');

  assert.ok(game.passedPlayerIds.includes('B'));
  assert.equal(game.currentPlayerId, 'C');
  assert.equal(game.status, 'playing');
});

test('a pogoni leaver plays the smallest normal card together with DVK on a free turn', () => {
  const game = makeGame('pogoni', ['A', 'B', 'C', 'D']);
  game.currentPlayerId = 'B';
  player(game, 'B').hand = [makeCard('7S', '7'), makeDvk(), makeCard('4S', '4')];

  removePlayer(game, 'B');

  assert.equal(game.table.playerId, 'B');
  assert.deepEqual(game.table.cards.map(card => card.id), ['4S', 'DVK']);
  assert.deepEqual(player(game, 'B').hand.map(card => card.id), ['7S']);
  assert.equal(game.currentPlayerId, 'C');
});

test('pogoni leavers are removed before the next round', () => {
  const game = makeGame('pogoni', ['A', 'B', 'C']);
  game.currentPlayerId = 'A';
  removePlayer(game, 'B');
  game.status = 'round_finished';
  game.roundWinnerId = 'A';

  nextRound(game);

  assert.deepEqual(game.players.map(item => item.id), ['A', 'C']);
  assert.equal(game.status, 'playing');
});

test('the next clockwise player becomes host after the host leaves', () => {
  const game = makeGame('classic', ['A', 'B', 'C', 'D']);
  game.hostPlayerId = 'C';

  removePlayer(game, 'C');

  assert.equal(game.hostPlayerId, 'D');
});

test('the remaining player wins when the opponent leaves', () => {
  const game = makeGame('classic', ['A', 'B']);
  game.currentPlayerId = 'B';

  removePlayer(game, 'B');

  assert.equal(game.status, 'finished');
  assert.equal(game.roundWinnerId, 'A');
  assert.equal(game.currentPlayerId, null);
});

test('a finished game cannot deal the full deck to one remaining player', () => {
  const game = makeGame('classic', ['A', 'B']);
  removePlayer(game, 'B');
  const handBeforeRestart = [...player(game, 'A').hand];

  assert.throws(() => restartGame(game), /2/);
  assert.equal(game.status, 'finished');
  assert.deepEqual(player(game, 'A').hand, handBeforeRestart);
});

test('leaving after finishing does not erase another player turn', () => {
  const game = makeGame('pogoni', ['A', 'B', 'C']);
  player(game, 'A').active = false;
  game.places = ['A'];
  game.roundWinnerId = 'A';
  game.currentPlayerId = 'B';

  removePlayer(game, 'A');

  assert.equal(game.status, 'playing');
  assert.equal(game.currentPlayerId, 'B');
  assert.equal(game.roundWinnerId, 'A');
  assert.equal(player(game, 'A').leaving, true);
});
