import { addPlayer, createGame, nextRound, pass, playCards, startGame } from './game.js';
import { chooseBotAction, TRAINED_BOT_WEIGHTS } from './bot-strategy.js';

export function createSeededRandom(seed = 1) {
  let state = Number(seed) >>> 0 || 1;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function winnerId(game) {
  if (game.roundWinnerId) return game.roundWinnerId;
  if (game.places?.length) return game.places[0];
  return game.players.find(player => player.id !== game.loserId)?.id || null;
}

export function simulateBotGame({
  mode = 'classic',
  playerWeights = [TRAINED_BOT_WEIGHTS, TRAINED_BOT_WEIGHTS],
  seed = 1,
  maxTurns = 20_000,
} = {}) {
  if (mode === 'elimination' && playerWeights.length < 3) {
    throw new Error('Elimination simulation requires at least three bots');
  }
  if (playerWeights.length < 2 || playerWeights.length > 11) {
    throw new Error('Simulation requires 2–11 bots');
  }

  const random = createSeededRandom(seed);
  const originalRandom = Math.random;
  Math.random = random;
  try {
    const game = createGame(`SIM-${seed}`, mode);
    playerWeights.forEach((weights, index) => addPlayer(game, {
      id: `bot-${index + 1}`,
      name: `Bot ${index + 1}`,
      isBot: true,
      simulationWeights: weights,
    }));
    startGame(game);

    let turns = 0;
    let rounds = 1;
    while (game.status !== 'finished' && turns < maxTurns) {
      if (game.status === 'round_finished') {
        nextRound(game);
        rounds += 1;
        continue;
      }

      const player = game.players.find(item => item.id === game.currentPlayerId);
      if (!player) throw new Error('Simulation has no current player');
      const action = chooseBotAction(game, player.id, player.simulationWeights);
      if (action?.type === 'play') {
        playCards(game, player.id, action.cardIds, action.declaredRanks || {});
      } else if (action?.type === 'pass') {
        pass(game, player.id);
      } else {
        throw new Error(`Bot ${player.id} could not choose an action`);
      }
      turns += 1;
    }

    return {
      seed,
      mode,
      winnerId: game.status === 'finished' ? winnerId(game) : null,
      completed: game.status === 'finished',
      turns,
      rounds,
    };
  } finally {
    Math.random = originalRandom;
  }
}

export function evaluateWeights({
  candidate,
  baseline = TRAINED_BOT_WEIGHTS,
  games = 100,
  seed = 1,
  mode = 'classic',
} = {}) {
  let wins = 0;
  let losses = 0;
  let incomplete = 0;
  let turns = 0;

  for (let index = 0; index < games; index += 1) {
    const candidateFirst = index % 2 === 0;
    const weights = candidateFirst ? [candidate, baseline] : [baseline, candidate];
    // Each deal is played twice with swapped seats, removing first-seat and
    // shuffle luck from the comparison.
    const result = simulateBotGame({
      mode,
      playerWeights: weights,
      seed: seed + Math.floor(index / 2),
    });
    turns += result.turns;
    if (!result.completed) incomplete += 1;
    else if (result.winnerId === (candidateFirst ? 'bot-1' : 'bot-2')) wins += 1;
    else losses += 1;
  }

  return {
    games,
    wins,
    losses,
    incomplete,
    winRate: games ? wins / games : 0,
    averageTurns: games ? turns / games : 0,
  };
}
