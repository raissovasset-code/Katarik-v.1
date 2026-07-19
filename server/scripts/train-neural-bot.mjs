import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chooseBotAction } from '../src/bot-strategy.js';
import { createSeededRandom, evaluatePolicies, simulateBotGame } from '../src/bot-simulator.js';
import {
  chooseNeuralAction,
  createNeuralModel,
  neuralTrainingExample,
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

const imitationGames = positiveInteger('imitation-games', 400);
const epochs = positiveInteger('epochs', 3);
const tournamentGames = positiveInteger('tournament-games', 1000);
const seed = positiveInteger('seed', 20260719);
const candidatePath = path.resolve(argument(
  'output',
  path.join(__dirname, '../src/neural-bot-candidate.json'),
));
const publishedPath = path.resolve(argument(
  'published-output',
  path.join(__dirname, '../src/neural-bot-model.json'),
));
const model = createNeuralModel({ random: createSeededRandom(seed) });

const epochMetrics = [];
for (let epoch = 1; epoch <= epochs; epoch += 1) {
  let examples = 0;
  let correct = 0;
  let loss = 0;
  for (let gameIndex = 0; gameIndex < imitationGames; gameIndex += 1) {
    simulateBotGame({
      mode: 'classic',
      seed: seed + epoch * 1_000_000 + gameIndex,
      onDecision: ({ game, player, action }) => {
        const example = neuralTrainingExample(game, player.id, action);
        if (!example || example.inputs.length < 2) return;
        const result = trainNeuralChoice(model, example.inputs, example.chosenIndex, 0.008);
        examples += 1;
        correct += Number(result.correct);
        loss += result.loss;
      },
    });
  }
  const metrics = {
    epoch,
    examples,
    accuracy: examples ? correct / examples : 0,
    averageLoss: examples ? loss / examples : 0,
  };
  epochMetrics.push(metrics);
  console.log(JSON.stringify(metrics));
}

const neuralPolicy = (game, playerId) => chooseNeuralAction(game, playerId, model);
const heuristicPolicy = (game, playerId) => chooseBotAction(game, playerId);
const tournament = evaluatePolicies({
  candidate: neuralPolicy,
  baseline: heuristicPolicy,
  games: tournamentGames,
  seed: seed + 9_000_000,
});
const accepted = tournament.incomplete === 0 && tournament.winRate >= 0.55;
const artifact = {
  ...model,
  metadata: {
    trainedAt: new Date().toISOString(),
    seed,
    imitationGames,
    epochs,
    tournament,
    accepted,
    epochMetrics,
  },
};

fs.writeFileSync(candidatePath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
if (accepted) fs.writeFileSync(publishedPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ candidatePath, publishedPath: accepted ? publishedPath : null, accepted, tournament }));
