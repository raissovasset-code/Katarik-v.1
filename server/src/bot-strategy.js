import { canBeat, detectBestCombination } from './game.js';

const STRAIGHT_RANKS = ['4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const RANK_VALUE = Object.fromEntries(
  [...STRAIGHT_RANKS, '2', '3'].map((rank, index) => [rank, index + 1]),
);

function combinations(items, count) {
  const result = [];

  function visit(start, selected) {
    if (selected.length === count) {
      result.push(selected);
      return;
    }
    for (let index = start; index <= items.length - (count - selected.length); index += 1) {
      visit(index + 1, [...selected, items[index]]);
    }
  }

  visit(0, []);
  return result;
}

function cartesian(groups) {
  let rows = [[]];
  for (const group of groups) {
    rows = rows.flatMap(row => group.map(item => [...row, ...item]));
  }
  return rows;
}

function cardsByRank(hand) {
  const result = new Map();
  for (const card of hand.filter(item => item.type === 'normal')) {
    const cards = result.get(card.rank) || [];
    cards.push(card);
    result.set(card.rank, cards);
  }
  return result;
}

function leavesInvalidDvkRemainder(hand, selectedIds) {
  const remaining = hand.filter(card => !selectedIds.has(card.id));
  return remaining.some(card => card.type === 'wild')
    && remaining.every(card => card.type === 'wild' || card.type === 'joker');
}

export function generateBotMoves(game, player) {
  const candidates = new Map();
  const byRank = cardsByRank(player.hand);
  const dvk = player.hand.find(card => card.type === 'wild');

  function add(cards, declaredRanks = {}) {
    const ids = cards.map(card => card.id).sort();
    const key = ids.join('|');
    if (candidates.has(key) || leavesInvalidDvkRemainder(player.hand, new Set(ids))) return;

    const combo = detectBestCombination(cards, declaredRanks);
    if (!combo || !canBeat(game.table?.combo || null, combo)) return;
    candidates.set(key, { cardIds: ids, declaredRanks, combo, cards });
  }

  for (const card of player.hand) {
    if (card.type !== 'wild') add([card]);
  }

  for (const [rank, cards] of byRank.entries()) {
    for (const size of [2, 3, 4]) {
      for (const group of combinations(cards, size)) add(group);
      if (dvk && size > 1) {
        for (const group of combinations(cards, size - 1)) {
          add([...group, dvk], { DVK: rank });
        }
      }
    }
  }

  for (let length = 4; length <= STRAIGHT_RANKS.length; length += 1) {
    for (let start = 0; start <= STRAIGHT_RANKS.length - length; start += 1) {
      const ranks = STRAIGHT_RANKS.slice(start, start + length);
      const groups = ranks.map(rank => (byRank.get(rank) || []).map(card => [card]));
      if (groups.every(group => group.length > 0)) {
        for (const cards of cartesian(groups)) add(cards);
      }
      if (dvk && groups.filter(group => group.length === 0).length === 1) {
        const filled = groups.map(group => group.length ? group : [[dvk]]);
        for (const cards of cartesian(filled)) add(cards);
      }
    }
  }

  for (let pairCount = 3; pairCount <= STRAIGHT_RANKS.length; pairCount += 1) {
    for (let start = 0; start <= STRAIGHT_RANKS.length - pairCount; start += 1) {
      const ranks = STRAIGHT_RANKS.slice(start, start + pairCount);
      const groups = ranks.map(rank => combinations(byRank.get(rank) || [], 2));
      if (groups.every(group => group.length > 0)) {
        for (const cards of cartesian(groups)) add(cards);
      }
      if (dvk) {
        const shortRanks = ranks.filter(rank => (byRank.get(rank) || []).length === 1);
        const missingRanks = ranks.filter(rank => (byRank.get(rank) || []).length === 0);
        if (shortRanks.length === 1 && missingRanks.length === 0) {
          const filled = ranks.map(rank => {
            const cards = byRank.get(rank) || [];
            return cards.length === 1 ? [[cards[0], dvk]] : combinations(cards, 2);
          });
          for (const cards of cartesian(filled)) add(cards);
        }
      }
    }
  }

  return [...candidates.values()];
}

function remainingHandScore(cards) {
  const counts = new Map();
  for (const card of cards.filter(item => item.type === 'normal')) {
    counts.set(card.rank, (counts.get(card.rank) || 0) + 1);
  }

  const grouped = [...counts.values()].reduce((sum, count) => sum + count * count * 7, 0);
  const specials = cards.filter(card => card.type !== 'normal').length;
  return grouped - cards.length * 18 - specials * 4;
}

function moveScore(game, player, move) {
  const selected = new Set(move.cardIds);
  const remaining = player.hand.filter(card => !selected.has(card.id));
  const activeOpponents = game.players.filter(item => item.id !== player.id && item.active);
  const lowestOpponentHand = Math.min(...activeOpponents.map(item => item.hand.length), 99);
  const urgent = lowestOpponentHand <= 2;
  const usesDvk = move.cards.some(card => card.type === 'wild');
  const usesJoker = move.cards.some(card => card.type === 'joker');
  const winsNow = remaining.length === 0;
  const isPogoni = game.mode === 'pogoni';
  const canSetPogon = game.pogonReadyPlayerId === player.id;
  const usesCurrentPogon = move.cards.some(
    card => card.type === 'normal' && card.rank === player.pogonRank,
  );
  const keepsCurrentPogon = remaining.some(
    card => card.type === 'normal' && card.rank === player.pogonRank,
  );

  let score = move.cardIds.length * (urgent ? 115 : 75);
  score += remainingHandScore(remaining);
  score -= move.combo.high * (game.table ? 1 : 2.5);

  if (['straight', 'doubleStraight'].includes(move.combo.type)) score += move.cardIds.length * 24;
  if (move.combo.type === 'triple') score += 30;
  if (move.combo.type === 'quad' && !urgent && !winsNow) score -= 260;
  if (usesDvk && !urgent && !winsNow) score -= 150;
  if (usesJoker && !urgent && !winsNow) score -= game.table ? 90 : 180;
  if (urgent) score += move.combo.high * 3 + move.cardIds.length * 35;
  if (winsNow) score += 20_000;

  if (isPogoni && !canSetPogon) {
    // A player who empties their hand without a captured-table turn does not win
    // Pogoni. Preserve the rank needed for the next real pogon opportunity.
    if (winsNow) score -= 50_000;
    if (usesCurrentPogon && !keepsCurrentPogon) score -= 12_000;
  }

  if (isPogoni && canSetPogon && winsNow) {
    const counted = move.cards.filter(card => card.type === 'normal');
    if (counted.length && counted.every(card => card.rank === player.pogonRank)) score += 30_000;
  }

  return score;
}

export function chooseBotAction(game, playerId) {
  const player = game.players.find(item => item.id === playerId);
  if (!player || game.currentPlayerId !== playerId || game.status !== 'playing') return null;
  if (player.hand.length === 1 && player.hand[0]?.type === 'wild') {
    return { type: 'play', cardIds: [], declaredRanks: {} };
  }

  const moves = generateBotMoves(game, player)
    .map(move => ({ ...move, score: moveScore(game, player, move) }))
    .sort((a, b) => b.score - a.score || a.combo.high - b.combo.high);

  const best = moves[0];
  if (!best) return game.table ? { type: 'pass' } : null;

  const lowestOpponentHand = Math.min(
    ...game.players.filter(item => item.id !== player.id && item.active).map(item => item.hand.length),
    99,
  );
  const urgent = lowestOpponentHand <= 2;
  const usesDvk = best.cards.some(card => card.type === 'wild');
  const emptiesHand = best.cardIds.length === player.hand.length;

  if (
    game.mode === 'pogoni'
    && game.pogonReadyPlayerId !== player.id
    && game.table
    && emptiesHand
  ) {
    return { type: 'pass' };
  }

  if (game.table && !urgent && player.hand.length > 4) {
    if (best.combo.type === 'quad' && game.table.combo.type !== 'quad') return { type: 'pass' };
    if (usesDvk && best.cardIds.length <= 2) return { type: 'pass' };
  }

  return {
    type: 'play',
    cardIds: best.cardIds,
    declaredRanks: best.declaredRanks,
  };
}
