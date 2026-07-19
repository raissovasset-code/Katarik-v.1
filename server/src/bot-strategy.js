import { canBeat, detectBestCombination } from './game.js';
import fs from 'node:fs';

export const DEFAULT_BOT_WEIGHTS = Object.freeze({
  cardsUrgent: 115,
  cardsNormal: 75,
  groupStructure: 7,
  remainingCard: -18,
  remainingSpecial: -4,
  freeTableHigh: -2.5,
  activeTableHigh: -1,
  straightCard: 24,
  triple: 30,
  preserveQuad: -260,
  preserveDvk: -150,
  preserveJokerFree: -180,
  preserveJokerActive: -90,
  urgentHigh: 3,
  urgentCard: 35,
});

function loadTrainedWeights() {
  try {
    const saved = JSON.parse(
      fs.readFileSync(new URL('./trained-bot-weights.json', import.meta.url), 'utf8'),
    );
    return { ...DEFAULT_BOT_WEIGHTS, ...saved.weights };
  } catch {
    return { ...DEFAULT_BOT_WEIGHTS };
  }
}

export const TRAINED_BOT_WEIGHTS = Object.freeze(loadTrainedWeights());

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

function remainingHandScore(cards, weights) {
  const counts = new Map();
  for (const card of cards.filter(item => item.type === 'normal')) {
    counts.set(card.rank, (counts.get(card.rank) || 0) + 1);
  }

  const grouped = [...counts.values()].reduce(
    (sum, count) => sum + count * count * weights.groupStructure,
    0,
  );
  const specials = cards.filter(card => card.type !== 'normal').length;
  return grouped + cards.length * weights.remainingCard + specials * weights.remainingSpecial;
}

function isPogonTail(cards, rank) {
  if (!cards.length || cards.length > 4 || cards.some(card => card.type === 'joker')) return false;
  const normalCards = cards.filter(card => card.type === 'normal');
  if (!normalCards.length || !normalCards.every(card => card.rank === rank)) return false;
  const declaredRanks = cards.some(card => card.type === 'wild') ? { DVK: rank } : {};
  return Boolean(detectBestCombination(cards, declaredRanks));
}

function pogonCaptureBonus(move) {
  const typeBonus = {
    single: 0,
    pair: 3_000,
    triple: 7_000,
    straight: 10_000,
    doubleStraight: 13_000,
    quad: 18_000,
  }[move.combo.type] || 0;
  return 25_000 + typeBonus + move.combo.high * 20 + move.cardIds.length * 100;
}

function setsUpPogon(game, player, move) {
  if (game.mode !== 'pogoni' || !game.table || game.pogonReadyPlayerId === player.id) return false;
  if (move.cards.some(card => card.type === 'normal' && card.rank === player.pogonRank)) return false;
  const selected = new Set(move.cardIds);
  const remaining = player.hand.filter(card => !selected.has(card.id));
  return isPogonTail(remaining, player.pogonRank);
}

function finishesPogon(game, player, move) {
  return game.mode === 'pogoni'
    && game.pogonReadyPlayerId === player.id
    && move.cardIds.length === player.hand.length
    && isPogonTail(move.cards, player.pogonRank);
}

function endgameCaptureGroup(game, player, moves) {
  if (game.mode !== 'pogoni') return null;
  const redJokers = player.hand.filter(card => card.rank === 'RED_JOKER');
  const pogonCards = player.hand.filter(
    card => card.type === 'normal' && card.rank === player.pogonRank,
  );
  const captureCards = player.hand.filter(card => (
    card.rank !== 'RED_JOKER'
    && !(card.type === 'normal' && card.rank === player.pogonRank)
  ));
  if (redJokers.length !== 1 || !pogonCards.length || ![3, 4].includes(captureCards.length)) return null;
  if (!captureCards.every(card => card.type === 'normal' && card.rank === captureCards[0].rank)) {
    return null;
  }
  return moves.find(move => (
    move.cardIds.length === captureCards.length
    && move.cardIds.every(id => captureCards.some(card => card.id === id))
    && ['triple', 'quad'].includes(move.combo.type)
  )) || null;
}

function directPogonCaptureLead(game, player, moves) {
  if (game.mode !== 'pogoni') return null;
  const candidates = moves.filter(move => {
    if (move.cards.some(card => card.type === 'normal' && card.rank === player.pogonRank)) {
      return false;
    }
    const selected = new Set(move.cardIds);
    const remaining = player.hand.filter(card => !selected.has(card.id));
    return isPogonTail(remaining, player.pogonRank);
  });
  return candidates.sort((left, right) => (
    right.cardIds.length - left.cardIds.length
    || right.combo.high - left.combo.high
  ))[0] || null;
}

function preferredFreeLead(game, player, moves) {
  const directCapture = directPogonCaptureLead(game, player, moves);
  if (directCapture) return [directCapture];

  const endgameGroup = endgameCaptureGroup(game, player, moves);
  if (endgameGroup) return [endgameGroup];

  const narrowCombinations = moves.filter(
    move => ['straight', 'doubleStraight'].includes(move.combo.type),
  );
  if (narrowCombinations.length) {
    return narrowCombinations.sort((left, right) => (
      right.cardIds.length - left.cardIds.length
      || left.combo.high - right.combo.high
      || Number(right.combo.type === 'doubleStraight') - Number(left.combo.type === 'doubleStraight')
    ));
  }

  let singlesAndPairs = moves.filter(move => ['single', 'pair'].includes(move.combo.type));
  const rankCounts = cardsByRank(player.hand);
  const withoutBrokenCaptureGroups = singlesAndPairs.filter(move => !move.cards.some(card => (
    card.type === 'normal' && (rankCounts.get(card.rank)?.length || 0) >= 3
  )));
  if (withoutBrokenCaptureGroups.length) singlesAndPairs = withoutBrokenCaptureGroups;
  const withoutDvk = singlesAndPairs.filter(move => !move.cards.some(card => card.type === 'wild'));
  if (withoutDvk.length) singlesAndPairs = withoutDvk;
  if (singlesAndPairs.length) {
    return singlesAndPairs.sort((left, right) => (
      left.combo.high - right.combo.high
      || Number(right.combo.type === 'pair') - Number(left.combo.type === 'pair')
    ));
  }

  return moves.sort((left, right) => (
    left.combo.high - right.combo.high || right.cardIds.length - left.cardIds.length
  ));
}

function preferredTableResponse(game, player, moves) {
  const pogonSetupMoves = moves.filter(move => setsUpPogon(game, player, move));
  if (pogonSetupMoves.length) return pogonSetupMoves;

  const sortWeakestFirst = candidates => candidates.sort((left, right) => (
    Number(left.cards.some(card => card.type === 'wild'))
      - Number(right.cards.some(card => card.type === 'wild'))
    || left.combo.high - right.combo.high
    || left.cardIds.length - right.cardIds.length
  ));
  const sameType = moves.filter(move => move.combo.type === game.table.combo.type);
  const rankCounts = cardsByRank(player.hand);
  const sameTypeWithoutBrokenGroups = sameType.filter(move => !move.cards.some(card => {
    if (card.type !== 'normal') return false;
    const cardsOfRankInMove = move.cards.filter(
      selected => selected.type === 'normal' && selected.rank === card.rank,
    ).length;
    return (rankCounts.get(card.rank)?.length || 0) >= 3
      && cardsOfRankInMove < (rankCounts.get(card.rank)?.length || 0);
  }));
  if (sameTypeWithoutBrokenGroups.length) return sortWeakestFirst(sameTypeWithoutBrokenGroups);

  const triples = moves.filter(move => move.combo.type === 'triple');
  if (triples.length) return sortWeakestFirst(triples);

  if (sameType.length) return sortWeakestFirst(sameType);

  const quads = moves.filter(move => move.combo.type === 'quad');
  if (quads.length) return sortWeakestFirst(quads);

  return moves;
}

function moveScore(game, player, move, weights) {
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
  const preparesPogon = setsUpPogon(game, player, move);

  let score = move.cardIds.length * (urgent ? weights.cardsUrgent : weights.cardsNormal);
  score += remainingHandScore(remaining, weights);
  score += move.combo.high * (game.table ? weights.activeTableHigh : weights.freeTableHigh);

  if (['straight', 'doubleStraight'].includes(move.combo.type)) {
    score += move.cardIds.length * weights.straightCard;
  }
  if (move.combo.type === 'triple') score += weights.triple;
  if (move.combo.type === 'quad' && !urgent && !winsNow) score += weights.preserveQuad;
  if (usesDvk && !urgent && !winsNow) score += weights.preserveDvk;
  if (usesJoker && !urgent && !winsNow) {
    score += game.table ? weights.preserveJokerActive : weights.preserveJokerFree;
  }
  if (urgent) score += move.combo.high * weights.urgentHigh + move.cardIds.length * weights.urgentCard;
  if (winsNow) score += 20_000;

  if (isPogoni && !canSetPogon) {
    // A player who empties their hand without a captured-table turn does not win
    // Pogoni. Preserve the rank needed for the next real pogon opportunity.
    if (winsNow) score -= 50_000;
    if (usesCurrentPogon && !keepsCurrentPogon) score -= 12_000;
    if (preparesPogon) score += pogonCaptureBonus(move);
  }

  if (isPogoni && canSetPogon && winsNow) {
    const counted = move.cards.filter(card => card.type === 'normal');
    if (counted.length && counted.every(card => card.rank === player.pogonRank)) score += 30_000;
  }

  return score;
}

export function chooseBotAction(game, playerId, weights = TRAINED_BOT_WEIGHTS) {
  const player = game.players.find(item => item.id === playerId);
  if (!player || game.currentPlayerId !== playerId || game.status !== 'playing') return null;
  if (player.hand.length === 1 && player.hand[0]?.type === 'wild') {
    return { type: 'play', cardIds: [], declaredRanks: {} };
  }

  let moves = generateBotMoves(game, player)
    .map(move => ({ ...move, score: moveScore(game, player, move, weights) }))
    .sort((a, b) => b.score - a.score || a.combo.high - b.combo.high);

  if (game.mode === 'pogoni' && game.pogonReadyPlayerId !== player.id) {
    const movesWithoutPogon = moves.filter(move => !move.cards.some(
      card => card.type === 'normal' && card.rank === player.pogonRank,
    ));
    if (movesWithoutPogon.length) {
      moves = movesWithoutPogon;
    } else if (game.table) {
      return { type: 'pass' };
    } else {
      const nonFinishingMoves = moves.filter(move => move.cardIds.length < player.hand.length);
      if (nonFinishingMoves.length) moves = nonFinishingMoves;
    }
  } else if (game.mode === 'pogoni' && game.pogonReadyPlayerId === player.id) {
    const finishingPogonMoves = moves.filter(move => finishesPogon(game, player, move));
    if (finishingPogonMoves.length) {
      moves = finishingPogonMoves;
    } else {
      const movesWithoutPogon = moves.filter(move => !move.cards.some(
        card => card.type === 'normal' && card.rank === player.pogonRank,
      ));
      if (movesWithoutPogon.length) moves = movesWithoutPogon;
    }
  }

  if (game.table) {
    moves = preferredTableResponse(game, player, moves);
  } else {
    moves = preferredFreeLead(game, player, moves);
  }

  const best = moves[0];
  if (!best) return game.table ? { type: 'pass' } : null;

  const lowestOpponentHand = Math.min(
    ...game.players.filter(item => item.id !== player.id && item.active).map(item => item.hand.length),
    99,
  );
  const urgent = lowestOpponentHand <= 2;
  const usesDvk = best.cards.some(card => card.type === 'wild');
  const emptiesHand = best.cardIds.length === player.hand.length;
  const preparesPogon = setsUpPogon(game, player, best);

  if (
    game.mode === 'pogoni'
    && game.pogonReadyPlayerId !== player.id
    && game.table
    && emptiesHand
  ) {
    return { type: 'pass' };
  }

  if (game.table && !urgent && player.hand.length > 4) {
    if (!preparesPogon && best.combo.type === 'quad' && game.table.combo.type !== 'quad') {
      return { type: 'pass' };
    }
    if (!preparesPogon && usesDvk && best.cardIds.length <= 2) return { type: 'pass' };
  }

  return {
    type: 'play',
    cardIds: best.cardIds,
    declaredRanks: best.declaredRanks,
  };
}
