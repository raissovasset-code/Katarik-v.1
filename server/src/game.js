const SUITS = ['S', 'H', 'D', 'C'];
const RANKS = ['4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2', '3'];
const POGON_ORDER = ['4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

const RANK_VALUE = Object.fromEntries(RANKS.map((rank, index) => [rank, index + 1]));
RANK_VALUE.BLACK_JOKER = 14;
RANK_VALUE.RED_JOKER = 15;

export function createDeck() {
  const deck = [];

  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ id: `${rank}${suit}`, rank, suit, type: 'normal' });
    }
  }

  deck.push({ id: 'BLACK_JOKER', rank: 'BLACK_JOKER', suit: null, type: 'joker' });
  deck.push({ id: 'RED_JOKER', rank: 'RED_JOKER', suit: null, type: 'joker' });
  deck.push({ id: 'DVK', rank: 'DVK', suit: null, type: 'wild' });

  return shuffle(deck);
}

export function createGame(roomId, mode = 'classic') {
  return {
    roomId,
    mode,
    hostPlayerId: null,
    eliminatedIds: [],
    roundWinnerId: null,
    status: 'lobby',
    players: [],
    burned: [],
    table: null,
    currentPlayerId: null,
    lastPlayedPlayerId: null,
    passedPlayerIds: [],
    pogonReadyPlayerId: null,
    roundStarterId: null,
    places: [],
    loserId: null,
  };
}

export function addPlayer(game, player) {
  if (game.status !== 'lobby') throw new Error('Игра уже началась');
  if (game.players.length >= 11) throw new Error('Максимум 11 игроков');

  if (!game.players.some(existing => existing.id === player.id)) {
    game.players.push({
      ...player,
      name: uniquePlayerName(game.players, player.name),
      hand: [],
      active: true,
      pogonRank: '4',
    });
  }
}

export function uniquePlayerName(players, requestedName = 'Игрок') {
  const baseName = String(requestedName || 'Игрок').trim() || 'Игрок';
  const usedNames = new Set(players.map(player => player.name));

  if (!usedNames.has(baseName)) return baseName;

  for (let index = 2; index <= players.length + 2; index += 1) {
    const candidate = `${baseName} ${index}`;
    if (!usedNames.has(candidate)) return candidate;
  }

  return `${baseName} ${Date.now()}`;
}

export function startGame(game) {
  if (game.players.length < 2) throw new Error('Минимум 2 игрока');

  dealRound(game, game.players);
  const starter = game.players.find(player => player.hand.some(card => card.id === '4S')) || game.players[0];
  startRound(game, starter);
}

export function restartGame(game) {
  if (!game) throw new Error('Комната не найдена');

  dealRound(game, game.players);
  const starterId = game.places?.[0];
  const starter = game.players.find(player => player.id === starterId) || game.players[0];
  startRound(game, starter);
}

export function nextRound(game) {
  if (!game) throw new Error('Комната не найдена');
  if (!['elimination', 'pogoni'].includes(game.mode)) {
    throw new Error('Следующий кон доступен только для режимов На вылет и Погоны');
  }

  const playersInRound =
    game.mode === 'elimination'
      ? game.players.filter(player => !game.eliminatedIds.includes(player.id))
      : game.players;

  if (playersInRound.length <= 1) {
    game.status = 'finished';
    game.roundWinnerId = playersInRound[0]?.id || null;
    return;
  }

  dealRound(game, playersInRound);

  if (game.mode === 'elimination') {
    game.players
      .filter(player => game.eliminatedIds.includes(player.id))
      .forEach(player => {
        player.hand = [];
        player.active = false;
      });
  }

  const starter = playersInRound.find(player => player.id === game.roundWinnerId) || playersInRound[0];
  startRound(game, starter);
}

export function sortHand(hand) {
  return [...hand].sort(
    (a, b) => cardValue(a) - cardValue(b) || String(a.suit).localeCompare(String(b.suit))
  );
}

export function pass(game, playerId) {
  ensureTurn(game, playerId);

  if (!game.table) throw new Error('Нельзя пасовать первым ходом');
  if (!game.passedPlayerIds.includes(playerId)) game.passedPlayerIds.push(playerId);

  const active = activePlayers(game);
  const others = active.filter(player => player.id !== game.lastPlayedPlayerId);
  const allOthersPassed = others.every(player => game.passedPlayerIds.includes(player.id));

  if (allOthersPassed) {
    finishTrick(game);
  } else {
    game.currentPlayerId = nextActivePlayerId(game, playerId);
  }
}

export function playCards(game, playerId, cardIds, declaredRanks = {}) {
  ensureTurn(game, playerId);

  const player = game.players.find(item => item.id === playerId);
  if (!Array.isArray(cardIds)) throw new Error('Неверный список карт');
  if (new Set(cardIds).size !== cardIds.length) {
    throw new Error('Нельзя сыграть одну карту дважды');
  }

  if (hasOnlyDVK(player)) {
    finishDvkOnlyPlayer(game, player);
    return;
  }

  const cards = cardIds.map(id => player.hand.find(card => card.id === id));
  if (cards.some(card => !card)) throw new Error('Карты не найдены в руке');

  const combo = detectBestCombination(cards, declaredRanks);
  if (!combo) throw new Error('Недопустимая комбинация');
  if (!canBeat(game.table?.combo || null, combo)) {
    throw new Error('Эта комбинация не бьет стол');
  }

  const canSetPogon = game.pogonReadyPlayerId === playerId;

  player.hand = player.hand.filter(card => !cardIds.includes(card.id));
  game.table = { playerId, cards, combo };
  game.lastPlayedPlayerId = playerId;
  game.passedPlayerIds = [];
  game.pogonReadyPlayerId = null;

  if (player.hand.length === 0 && !game.places.includes(playerId)) {
    const roundStopped = finishPlayer(game, player, cards, canSetPogon);
    if (roundStopped) return;
  }

  if (finishRoundIfOnePlayerLeft(game)) return;

  game.currentPlayerId = nextActivePlayerId(game, playerId);
}

export function detectBestCombination(cards, declaredRanks = {}) {
  if (!cards.length) return null;

  if (cards.length === 1) {
    const card = cards[0];
    if (card.type === 'wild') return null;
    return { type: 'single', high: cardValue(card), length: 1 };
  }

  const fixed = cards.filter(card => card.type !== 'wild');
  if (fixed.some(card => card.type === 'joker')) return null;

  const ranks = fixed.map(card => card.rank);
  const uniqueRanks = [...new Set(ranks)];

  if (uniqueRanks.length <= 1 && [2, 3, 4].includes(cards.length)) {
    const rank = uniqueRanks[0] || declaredRanks.DVK;
    if (!rank || !RANK_VALUE[rank] || rank === 'BLACK_JOKER' || rank === 'RED_JOKER') return null;

    const type = cards.length === 2 ? 'pair' : cards.length === 3 ? 'triple' : 'quad';
    return { type, high: RANK_VALUE[rank], length: cards.length };
  }

  return detectStraight(cards) || detectDoubleStraight(cards) || null;
}

export function canBeat(prev, next) {
  if (!prev) return true;

  if (prev.type === 'single' && prev.high === RANK_VALUE.RED_JOKER) {
    return next.type === 'quad';
  }

  if (next.type === 'quad') {
    return prev.type === 'quad' ? next.high > prev.high : true;
  }

  if (next.type === 'triple') {
    return (
      ['single', 'pair', 'triple', 'straight'].includes(prev.type) &&
      (prev.type !== 'triple' || next.high > prev.high)
    );
  }

  if (prev.type === next.type) {
    if (['straight', 'doubleStraight'].includes(prev.type) && prev.length !== next.length) {
      return false;
    }

    return next.high > prev.high;
  }

  return false;
}

export function publicGameState(game, viewerId) {
  const me = game.players.find(player => player.id === viewerId);

  return {
    ...game,
    hand: me ? me.hand : [],
    players: game.players.map(player => ({
      id: player.id,
      name: player.name,
      active: player.active,
      handCount: player.hand.length,
      pogonRank: player.pogonRank,
    })),
    burned: undefined,
  };
}

function shuffle(cards) {
  const arr = [...cards];

  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }

  return arr;
}

function dealRound(game, players) {
  const deck = createDeck();
  const dealSlots = players.length === 2 ? 3 : players.length;
  const hands = Array.from({ length: dealSlots }, () => []);

  deck.forEach((card, index) => hands[index % dealSlots].push(card));

  players.forEach((player, index) => {
    player.hand = sortHand(hands[index]);
    player.active = true;
  });

  game.burned = players.length === 2 ? hands[2] : [];
}

function startRound(game, starter) {
  game.status = 'playing';
  game.currentPlayerId = starter.id;
  game.roundStarterId = starter.id;
  game.lastPlayedPlayerId = null;
  game.table = null;
  game.passedPlayerIds = [];
  game.pogonReadyPlayerId = null;
  game.places = [];
  game.loserId = null;
}

function cardValue(card) {
  if (card.type === 'wild') return 99;
  return RANK_VALUE[card.rank] || 0;
}

function finishTrick(game) {
  const last = game.players.find(player => player.id === game.lastPlayedPlayerId);
  game.table = null;
  game.passedPlayerIds = [];
  game.pogonReadyPlayerId = null;

  if (last?.active) {
    game.currentPlayerId = last.id;
    game.pogonReadyPlayerId = last.id;
  } else {
    game.currentPlayerId = nextActivePlayerId(game, last?.id || game.currentPlayerId);
  }
}

function finishDvkOnlyPlayer(game, player) {
  if (game.mode === 'elimination') {
    if (!game.eliminatedIds.includes(player.id)) game.eliminatedIds.push(player.id);

    player.active = false;
    const alive = game.players.filter(item => !game.eliminatedIds.includes(item.id));

    if (alive.length === 1) {
      game.roundWinnerId = alive[0].id;
      game.status = 'finished';
    } else {
      game.status = 'round_finished';
    }

    return;
  }

  game.loserId = player.id;
  game.status = 'finished';
}

function finishPlayer(game, player, playedCards, canSetPogon) {
  game.places.push(player.id);
  player.active = false;

  if (game.mode === 'pogoni') {
    const pogonResult = canSetPogon
      ? checkPogon(player, playedCards)
      : { success: false };

    if (pogonResult.success) {
      player.pogonRank = pogonResult.nextRank;
      game.status = pogonResult.finished ? 'finished' : 'round_finished';
      game.roundWinnerId = game.places[0] || player.id;
      return true;
    }

    game.roundWinnerId = game.places[0] || player.id;
    return false;
  }

  return false;
}

function finishRoundIfOnePlayerLeft(game) {
  const remaining = activePlayers(game);
  if (remaining.length !== 1) return false;

  const loser = remaining[0];
  game.loserId = loser.id;

  if (game.mode === 'elimination') {
    if (!game.eliminatedIds.includes(loser.id)) game.eliminatedIds.push(loser.id);

    loser.active = false;
    const alive = game.players.filter(player => !game.eliminatedIds.includes(player.id));

    if (alive.length === 1) {
      game.status = 'finished';
      game.roundWinnerId = alive[0].id;
    } else {
      game.status = 'round_finished';
      game.roundWinnerId = game.places[0] || null;
    }

    return true;
  }

  if (game.mode === 'pogoni') {
    game.status = 'round_finished';
    game.roundWinnerId = game.places[0] || null;
    return true;
  }

  game.status = 'finished';
  return true;
}

function activePlayers(game) {
  return game.players.filter(player => player.active);
}

function nextActivePlayerId(game, fromPlayerId) {
  const index = game.players.findIndex(player => player.id === fromPlayerId);

  for (let step = 1; step <= game.players.length; step++) {
    const next = game.players[(index + step + game.players.length) % game.players.length];
    if (next.active) return next.id;
  }

  return null;
}

function hasOnlyDVK(player) {
  return player.hand.length === 1 && player.hand[0]?.type === 'wild';
}

function ensureTurn(game, playerId) {
  if (game.status !== 'playing') throw new Error('Игра не идет');
  if (game.currentPlayerId !== playerId) throw new Error('Сейчас ход другого игрока');
}

function detectStraight(cards) {
  if (cards.length < 4) return null;

  const fixed = cards.filter(card => card.type !== 'wild');
  const wildCount = cards.length - fixed.length;
  const values = fixed.map(card => RANK_VALUE[card.rank]);

  if (new Set(values).size !== values.length) return null;
  if (Math.max(...values) > RANK_VALUE.A) return null;

  for (let start = 1; start <= RANK_VALUE.A - cards.length + 1; start++) {
    const needed = Array.from({ length: cards.length }, (_, index) => start + index);
    const missing = needed.filter(value => !values.includes(value)).length;

    if (values.every(value => needed.includes(value)) && missing === wildCount) {
      return { type: 'straight', high: start + cards.length - 1, length: cards.length };
    }
  }

  return null;
}

function detectDoubleStraight(cards) {
  if (cards.length < 6 || cards.length % 2 !== 0) return null;

  const pairCount = cards.length / 2;
  const fixed = cards.filter(card => card.type !== 'wild');
  const wildCount = cards.length - fixed.length;
  const counts = {};

  for (const card of fixed) {
    const value = RANK_VALUE[card.rank];
    if (!value || value > RANK_VALUE.A) return null;

    counts[value] = (counts[value] || 0) + 1;
    if (counts[value] > 2) return null;
  }

  for (let start = 1; start <= RANK_VALUE.A - pairCount + 1; start++) {
    const needed = Array.from({ length: pairCount }, (_, index) => start + index);
    const fixedValues = Object.keys(counts).map(Number);
    if (!fixedValues.every(value => needed.includes(value))) continue;

    const missing = needed.reduce((sum, value) => sum + (2 - (counts[value] || 0)), 0);
    if (missing === wildCount) {
      return { type: 'doubleStraight', high: start + pairCount - 1, length: pairCount };
    }
  }

  return null;
}

function checkPogon(player, cards) {
  const current = player.pogonRank || '4';

  if (!cards.length) return { success: false };
  if (cards.some(card => card.type === 'wild' || card.type === 'joker')) return { success: false };
  if (!cards.every(card => card.rank === current)) return { success: false };

  if (current === 'A') {
    return { success: true, finished: true, nextRank: 'A' };
  }

  const index = POGON_ORDER.indexOf(current);
  const nextIndex = Math.min(index + cards.length, POGON_ORDER.length - 1);

  return {
    success: true,
    finished: false,
    nextRank: POGON_ORDER[nextIndex],
  };
}
