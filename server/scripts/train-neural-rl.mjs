import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chooseBotAction } from '../src/bot-strategy.js';
import { createSeededRandom, evaluatePolicies, simulateBotGame } from '../src/bot-simulator.js';
import {
  NEURAL_INPUT_SIZE,
  chooseNeuralAction,
  createNeuralModel,
  sampleNeuralAction,
  trainNeuralChoice,
} from '../src/neural-bot.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function argument(name, fallback) {
  const entry = process.argv.find(value => value.startsWith(`--${name}=`));
  return entry ? entry.slice(name.length + 3) : fallback;
}

function positiveInteger(name, fallback) {
  const value = Number(argument(name, fallback));
  if (!Number.isInteger(value) || value <= 0) throw new Error(`--${name} must be positive`);
  return value;
}

function loadStartingModel(random) {
  const requested = argument('model', path.join(__dirname, '../src/neural-bot-candidate.json'));
  for (const candidate of [requested, path.join(__dirname, '../src/neural-bot-model.json')]) {
    try {
      const model = JSON.parse(fs.readFileSync(path.resolve(candidate), 'utf8'));
      if (model.inputSize === NEURAL_INPUT_SIZE) return { model, source: path.resolve(candidate) };
    } catch {
      // Try the next source; a fresh model is the final safe fallback.
    }
  }
  return { model: createNeuralModel({ random }), source: 'fresh' };
}

const games = positiveInteger('games', 1000);
const generations = positiveInteger('generations', 8);
const tournamentGames = positiveInteger('tournament-games', 1000);
const seed = positiveInteger('seed', 20260719);
const learningRate = Number(argument('learning-rate', 0.002));
const output = path.resolve(argument('output', path.join(__dirname, '../src/neural-bot-rl-candidate.json')));
const publishedOutput = path.resolve(argument(
  'published-output', path.join(__dirname, '../src/neural-bot-model.json'),
));
const random = createSeededRandom(seed);
const starting = loadStartingModel(random);
let model = structuredClone(starting.model);
let bestModel = structuredClone(model);
let bestWinRate = 0;
const history = [];
const heuristicPolicy = (game, playerId) => chooseBotAction(game, playerId);

for (let generation = 1; generation <= generations; generation += 1) {
  const temperature = Math.max(0.4, 1.2 - (generation - 1) * 0.1);
  let decisions = 0;
  let rewardTotal = 0;
  for (let gameIndex = 0; gameIndex < games; gameIndex += 1) {
    const trajectories = new Map([['bot-1', []], ['bot-2', []]]);
    const makePolicy = playerKey => (game, playerId) => {
      const sampled = sampleNeuralAction(game, playerId, model, { random, temperature });
      trajectories.get(playerKey).push({ inputs: sampled.inputs, chosenIndex: sampled.chosenIndex });
      return sampled.action;
    };
    const result = simulateBotGame({
      mode: 'classic',
      playerPolicies: [makePolicy('bot-1'), makePolicy('bot-2')],
      seed: seed + generation * 1_000_000 + gameIndex,
    });
    if (!result.completed) continue;

    const updateOrder = random() < 0.5 ? ['bot-1', 'bot-2'] : ['bot-2', 'bot-1'];
    for (const playerId of updateOrder) {
      const reward = playerId === result.winnerId ? 1 : -1;
      const trajectory = trajectories.get(playerId);
      trajectory.forEach((step, index) => {
        const discountedReward = reward * (0.995 ** (trajectory.length - index - 1));
        trainNeuralChoice(model, step.inputs, step.chosenIndex, learningRate, discountedReward);
        decisions += 1;
        rewardTotal += discountedReward;
      });
    }
  }

  const validation = evaluatePolicies({
    candidate: (game, playerId) => chooseNeuralAction(game, playerId, model),
    baseline: heuristicPolicy,
    games: Math.min(400, tournamentGames),
    seed: seed + 7_000_000 + generation * 10_000,
  });
  if (validation.winRate > bestWinRate && validation.incomplete === 0) {
    bestWinRate = validation.winRate;
    bestModel = structuredClone(model);
  }
  const metrics = { generation, temperature, decisions, rewardTotal, validation };
  history.push(metrics);
  console.log(JSON.stringify(metrics));
}

const tournament = evaluatePolicies({
  candidate: (game, playerId) => chooseNeuralAction(game, playerId, bestModel),
  baseline: heuristicPolicy,
  games: tournamentGames,
  seed: seed + 9_000_000,
});
const accepted = tournament.incomplete === 0 && tournament.winRate >= 0.55;
const artifact = {
  ...bestModel,
  metadata: {
    trainedAt: new Date().toISOString(), method: 'self-play-policy-gradient',
    startingModel: starting.source, seed, gamesPerGeneration: games, generations,
    learningRate, tournament, accepted, history,
  },
};
fs.writeFileSync(output, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
if (accepted) fs.writeFileSync(publishedOutput, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ output, publishedOutput: accepted ? publishedOutput : null, accepted, tournament }));
