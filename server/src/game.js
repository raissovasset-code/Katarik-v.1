const SUITS = ['S', 'H', 'D', 'C']; // S = пики
const RANKS = ['4','5','6','7','8','9','10','J','Q','K','A','2','3'];
const RANK_VALUE = Object.fromEntries(RANKS.map((r, i) => [r, i + 1]));
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

function shuffle(cards) {
  const arr = [...cards];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function createGame(roomId) {
  return {
    roomId,
    status: 'lobby',
    players: [],
    burned: [],
    table: null,
    currentPlayerId: null,
    lastPlayedPlayerId: null,
    passedPlayerIds: [],
    roundStarterId: null,
    places: [],
    loserId: null,
    firstRound: true,
  };
}

export function addPlayer(game, player) {
  if (game.status !== 'lobby') throw new Error('Игра уже началась');
  if (game.players.length >= 11) throw new Error('Максимум 11 игроков');
  if (!game.players.some(p => p.id === player.id)) {
    game.players.push({ ...player, hand: [], active: true });
  }
}

export function startGame(game) {
  if (game.players.length < 2) throw new Error('Минимум 2 игрока');
  const deck = createDeck();
  const dealSlots = game.players.length === 2 ? 3 : game.players.length;
  const hands = Array.from({ length: dealSlots }, () => []);

  deck.forEach((card, index) => hands[index % dealSlots].push(card));

  game.players.forEach((p, index) => {
    p.hand = sortHand(hands[index]);
    p.active = true;
  });

  if (game.players.length === 2) game.burned = hands[2];

  const starter = game.players.find(p => p.hand.some(c => c.id === '4S')) || game.players[0];
  game.status = 'playing';
  game.currentPlayerId = starter.id;
  game.roundStarterId = starter.id;
  game.lastPlayedPlayerId = null;
  game.table = null;
  game.passedPlayerIds = [];
}

export function sortHand(hand) {
  return [...hand].sort((a, b) => cardValue(a) - cardValue(b) || String(a.suit).localeCompare(String(b.suit)));
}

function cardValue(card) {
  if (card.type === 'wild') return 99;
  return RANK_VALUE[card.rank] || 0;
}

export function pass(game, playerId) {
  ensureTurn(game, playerId);
  if (!game.table) throw new Error('Нельзя пасовать первым ходом');
  if (!game.passedPlayerIds.includes(playerId)) game.passedPlayerIds.push(playerId);

  const active = activePlayers(game);
  const others = active.filter(p => p.id !== game.lastPlayedPlayerId);
  const allOthersPassed = others.every(p => game.passedPlayerIds.includes(p.id));

  if (allOthersPassed) {
    finishTrick(game);
  } else {
    game.currentPlayerId = nextActivePlayerId(game, playerId);
  }
}

export function playCards(game, playerId, cardIds, declaredRanks = {}) {
  ensureTurn(game, playerId);
  const player = game.players.find(p => p.id === playerId);
  const cards = cardIds.map(id => player.hand.find(c => c.id === id));
  if (cards.some(c => !c)) throw new Error('Карты не найдены в руке');

  const combo = detectBestCombination(cards, declaredRanks);
  if (!combo) throw new Error('Недопустимая комбинация');
  if (!canBeat(game.table?.combo || null, combo)) throw new Error('Эта комбинация не бьёт стол');

  player.hand = player.hand.filter(c => !cardIds.includes(c.id));
  game.table = { playerId, cards, combo };
  game.lastPlayedPlayerId = playerId;
  game.passedPlayerIds = [];

  if (player.hand.length === 0 && !game.places.includes(playerId)) {
    game.places.push(playerId);
    player.active = false;
  }

  const remaining = activePlayers(game);
  if (remaining.length === 1) {
    game.loserId = remaining[0].id;
    game.status = 'finished';
    return;
  }

  if (combo.type === 'quad' && combo.high === RANK_VALUE['3']) {
    finishTrick(game);
  } else {
    game.currentPlayerId = nextActivePlayerId(game, playerId);
  }
}

function finishTrick(game) {
  const last = game.players.find(p => p.id === game.lastPlayedPlayerId);
  game.table = null;
  game.passedPlayerIds = [];

  if (last?.active) {
    game.currentPlayerId = last.id;
  } else {
    game.currentPlayerId = nextActivePlayerId(game, last?.id || game.currentPlayerId);
  }
}

function activePlayers(game) {
  return game.players.filter(p => p.active);
}

function nextActivePlayerId(game, fromPlayerId) {
  const players = game.players;
  let index = players.findIndex(p => p.id === fromPlayerId);
  for (let step = 1; step <= players.length; step++) {
    const next = players[(index + step + players.length) % players.length];
    if (next.active) return next.id;
  }
  return null;
}

function ensureTurn(game, playerId) {
  if (game.status !== 'playing') throw new Error('Игра не идёт');
  if (game.currentPlayerId !== playerId) throw new Error('Сейчас ход другого игрока');
}

export function detectBestCombination(cards, declaredRanks = {}) {
  if (!cards.length) return null;
  if (cards.length === 1) {
    const c = cards[0];
    if (c.type === 'wild') return null;
    return { type: 'single', high: cardValue(c), length: 1 };
  }

  const wilds = cards.filter(c => c.type === 'wild');
  const fixed = cards.filter(c => c.type !== 'wild');
  if (fixed.some(c => c.type === 'joker')) return null; // джокеры только одиночные

  const ranks = fixed.map(c => c.rank);
  const unique = [...new Set(ranks)];

  // pair/triple/quad with DVK
  if (unique.length <= 1 && [2,3,4].includes(cards.length)) {
    const rank = unique[0] || declaredRanks.DVK;
    if (!rank || !RANK_VALUE[rank] || rank === 'BLACK_JOKER' || rank === 'RED_JOKER') return null;
    const type = cards.length === 2 ? 'pair' : cards.length === 3 ? 'triple' : 'quad';
    return { type, high: RANK_VALUE[rank], length: cards.length };
  }

  const straight = detectStraight(cards, declaredRanks);
  if (straight) return straight;

  const doubleStraight = detectDoubleStraight(cards, declaredRanks);
  if (doubleStraight) return doubleStraight;

  return null;
}

function detectStraight(cards, declaredRanks) {
  if (cards.length < 4) return null;
  const fixed = cards.filter(c => c.type !== 'wild');
  const wildCount = cards.length - fixed.length;
  const values = fixed.map(c => RANK_VALUE[c.rank]);
  if (new Set(values).size !== values.length) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max > RANK_VALUE['A']) return null;
  if (max - min + 1 > cards.length) return null;

  for (let start = 1; start <= RANK_VALUE['A'] - cards.length + 1; start++) {
    const needed = Array.from({ length: cards.length }, (_, i) => start + i);
    const missing = needed.filter(v => !values.includes(v)).length;
    if (values.every(v => needed.includes(v)) && missing === wildCount) {
      return { type: 'straight', high: start + cards.length - 1, length: cards.length };
    }
  }
  return null;
}

function detectDoubleStraight(cards, declaredRanks) {
  if (cards.length < 6 || cards.length % 2 !== 0) return null;
  const pairCount = cards.length / 2;
  const fixed = cards.filter(c => c.type !== 'wild');
  const wildCount = cards.length - fixed.length;
  const counts = {};
  for (const c of fixed) {
    const v = RANK_VALUE[c.rank];
    if (!v || v > RANK_VALUE['A']) return null;
    counts[v] = (counts[v] || 0) + 1;
    if (counts[v] > 2) return null;
  }
  for (let start = 1; start <= RANK_VALUE['A'] - pairCount + 1; start++) {
    const needed = Array.from({ length: pairCount }, (_, i) => start + i);
    const fixedValues = Object.keys(counts).map(Number);
    if (!fixedValues.every(v => needed.includes(v))) continue;
    const missing = needed.reduce((sum, v) => sum + (2 - (counts[v] || 0)), 0);
    if (missing === wildCount) {
      return { type: 'doubleStraight', high: start + pairCount - 1, length: pairCount };
    }
  }
  return null;
}

export function canBeat(prev, next) {
  if (!prev) return true;

  // 3333 не бьётся ничем
  if (prev.type === 'quad' && prev.high === RANK_VALUE['3']) return false;

  // красный джокер одиночный бьётся только каре
  if (prev.type === 'single' && prev.high === RANK_VALUE.RED_JOKER) {
    return next.type === 'quad';
  }

  if (next.type === 'quad') {
    if (prev.type === 'quad') return next.high > prev.high;
    return true;
  }

  if (next.type === 'triple') {
    return ['single','pair','triple','straight'].includes(prev.type)
      && (prev.type !== 'triple' || next.high > prev.high);
  }

  if (prev.type === next.type) {
    if (['straight','doubleStraight'].includes(prev.type) && prev.length !== next.length) return false;
    return next.high > prev.high;
  }

  return false;
}

export function publicGameState(game, viewerId) {

  const me = game.players.find(p => p.id === viewerId);

  return {
    ...game,

    hand: me ? me.hand : [],

    players: game.players.map(p => ({
      id: p.id,
      name: p.name,
      active: p.active,
      handCount: p.hand.length,
    })),

    burned: undefined,
  };
}

export function restartGame(game) {
  if (!game) throw new Error('Комната не найдена');

  const deck = createDeck();
  const dealSlots = game.players.length === 2 ? 3 : game.players.length;
  const hands = Array.from({ length: dealSlots }, () => []);

  deck.forEach((card, index) => hands[index % dealSlots].push(card));

  game.players.forEach((p, index) => {
    p.hand = sortHand(hands[index]);
    p.active = true;
  });

  if (game.players.length === 2) {
    game.burned = hands[2];
  } else {
    game.burned = [];
  }

  const starterId = game.places?.[0];
  const starter = game.players.find(p => p.id === starterId) || game.players[0];

  game.status = 'playing';
  game.currentPlayerId = starter.id;
  game.roundStarterId = starter.id;
  game.lastPlayedPlayerId = null;
  game.table = null;
  game.passedPlayerIds = [];
  game.places = [];
  game.loserId = null;
}
