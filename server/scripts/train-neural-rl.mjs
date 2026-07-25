import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chooseBotAction } from "../src/bot-strategy.js";
import {
  createSeededRandom,
  evaluatePolicies,
  simulateBotGame,
} from "../src/bot-simulator.js";
import {
  NEURAL_INPUT_SIZE,
  chooseNeuralAction,
  createNeuralModel,
  sampleNeuralAction,
  neuralStepReward,
  shouldReplaceNeuralCheckpoint,
  trainNeuralChoice,
} from "../src/neural-bot.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function argument(name, fallback) {
  const entry = process.argv.find((value) => value.startsWith(`--${name}=`));
  return entry ? entry.slice(name.length + 3) : fallback;
}

function positiveInteger(name, fallback) {
  const value = Number(argument(name, fallback));
  if (!Number.isInteger(value) || value <= 0)
    throw new Error(`--${name} must be positive`);
  return value;
}

function numberInRange(name, fallback, minimum, maximum) {
  const value = Number(argument(name, fallback));
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`--${name} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function modelPaths(requested) {
  if (path.isAbsolute(requested)) return [requested];
  return [
    ...new Set([
      path.resolve(process.cwd(), requested),
      path.resolve(__dirname, "..", requested),
      path.resolve(__dirname, "../..", requested),
    ]),
  ];
}

function readCompatibleModel(candidate) {
  const model = JSON.parse(fs.readFileSync(candidate, "utf8"));
  if (model.inputSize !== NEURAL_INPUT_SIZE) {
    throw new Error(
      `incompatible input size ${model.inputSize}; expected ${NEURAL_INPUT_SIZE}`,
    );
  }
  return model;
}

function loadStartingModel(random) {
  const requested = argument("model", null);
  if (requested) {
    const attempted = modelPaths(requested);
    let lastError = null;
    for (const candidate of attempted) {
      try {
        return { model: readCompatibleModel(candidate), source: candidate };
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(
      `Cannot load --model=${requested}. Tried: ${attempted.join(", ")}. ${lastError?.message || ""}`,
    );
  }

  for (const candidate of [
    path.join(__dirname, "../src/neural-bot-rl-candidate.json"),
    path.join(__dirname, "../src/neural-bot-candidate.json"),
    path.join(__dirname, "../src/neural-bot-model.json"),
  ]) {
    try {
      return { model: readCompatibleModel(candidate), source: candidate };
    } catch {
      // Try the next source; a fresh model is the final safe fallback.
    }
  }
  return { model: createNeuralModel({ random }), source: "fresh" };
}

const games = positiveInteger("games", 1000);
const generations = positiveInteger("generations", 8);
const tournamentGames = positiveInteger("tournament-games", 1000);
const seed = positiveInteger("seed", 20260719);
const learningRate = Number(argument("learning-rate", 0.002));
const heuristicRatio = numberInRange("heuristic-ratio", 0.4, 0, 1);
const shapingScale = numberInRange("shaping-scale", 1, 0, 5);
const output = path.resolve(
  argument(
    "output",
    path.join(__dirname, "../src/neural-bot-rl-candidate.json"),
  ),
);
const publishedOutput = path.resolve(
  argument(
    "published-output",
    path.join(__dirname, "../src/neural-bot-model.json"),
  ),
);
const random = createSeededRandom(seed);
const starting = loadStartingModel(random);
let model = structuredClone(starting.model);
let bestModel = structuredClone(model);
const history = [];
const heuristicPolicy = (game, playerId) => chooseBotAction(game, playerId);
const validationSeed = seed + 7_000_000;
const validationGames = Math.min(400, tournamentGames);
const startingValidation = evaluatePolicies({
  candidate: (game, playerId) =>
    chooseNeuralAction(game, playerId, starting.model),
  baseline: heuristicPolicy,
  games: validationGames,
  seed: validationSeed,
});
let bestValidation = startingValidation;
console.log(
  JSON.stringify({ checkpoint: "starting", validation: startingValidation }),
);

for (let generation = 1; generation <= generations; generation += 1) {
  const temperature = Math.max(0.4, 1.2 - (generation - 1) * 0.1);
  let decisions = 0;
  let rewardTotal = 0;
  let heuristicGames = 0;
  let checkpointGames = 0;
  for (let gameIndex = 0; gameIndex < games; gameIndex += 1) {
    const neuralPlayerId =
      (gameIndex + generation) % 2 === 0 ? "bot-1" : "bot-2";
    const trajectory = [];
    const learnerPolicy = (game, playerId) => {
      const sampled = sampleNeuralAction(game, playerId, model, {
        random,
        temperature,
      });
      trajectory.push({
        inputs: sampled.inputs,
        chosenIndex: sampled.chosenIndex,
        shapingReward: neuralStepReward(game, playerId, sampled.action),
      });
      return sampled.action;
    };
    const useHeuristic = random() < heuristicRatio;
    const opponentPolicy = useHeuristic
      ? heuristicPolicy
      : (game, playerId) => chooseNeuralAction(game, playerId, bestModel);
    if (useHeuristic) heuristicGames += 1;
    else checkpointGames += 1;
    const playerPolicies =
      neuralPlayerId === "bot-1"
        ? [learnerPolicy, opponentPolicy]
        : [opponentPolicy, learnerPolicy];
    const result = simulateBotGame({
      mode: "classic",
      playerPolicies,
      seed: seed + generation * 1_000_000 + gameIndex,
    });
    if (!result.completed) continue;

    const terminalReward = neuralPlayerId === result.winnerId ? 1 : -1;
    trajectory.forEach((step, index) => {
      const discountedTerminal =
        terminalReward * 0.995 ** (trajectory.length - index - 1);
      const advantage = discountedTerminal + step.shapingReward * shapingScale;
      trainNeuralChoice(
        model,
        step.inputs,
        step.chosenIndex,
        learningRate,
        advantage,
      );
      decisions += 1;
      rewardTotal += advantage;
    });
  }

  const validation = evaluatePolicies({
    candidate: (game, playerId) => chooseNeuralAction(game, playerId, model),
    baseline: heuristicPolicy,
    games: validationGames,
    seed: validationSeed,
  });
  if (shouldReplaceNeuralCheckpoint(bestValidation, validation)) {
    bestValidation = validation;
    bestModel = structuredClone(model);
  }
  const metrics = {
    generation,
    temperature,
    decisions,
    rewardTotal,
    heuristicGames,
    checkpointGames,
    validation,
  };
  history.push(metrics);
  console.log(JSON.stringify(metrics));
}

const tournamentSeed = seed + 9_000_000;
const startingTournament = evaluatePolicies({
  candidate: (game, playerId) =>
    chooseNeuralAction(game, playerId, starting.model),
  baseline: heuristicPolicy,
  games: tournamentGames,
  seed: tournamentSeed,
});
const candidateTournament = evaluatePolicies({
  candidate: (game, playerId) => chooseNeuralAction(game, playerId, bestModel),
  baseline: heuristicPolicy,
  games: tournamentGames,
  seed: tournamentSeed,
});
const improved = shouldReplaceNeuralCheckpoint(
  startingTournament,
  candidateTournament,
);
const selectedModel = improved ? bestModel : starting.model;
const tournament = improved ? candidateTournament : startingTournament;
const accepted = tournament.incomplete === 0 && tournament.winRate >= 0.55;
const artifact = {
  ...selectedModel,
  metadata: {
    trainedAt: new Date().toISOString(),
    method: "self-play-policy-gradient",
    startingModel: starting.source,
    seed,
    gamesPerGeneration: games,
    generations,
    learningRate,
    heuristicRatio,
    shapingScale,
    startingValidation,
    bestValidation,
    startingTournament,
    candidateTournament,
    improved,
    tournament,
    accepted,
    history,
  },
};
function writeJsonAtomically(target, value) {
  const temporary = `${target}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, target);
}
writeJsonAtomically(output, artifact);
if (accepted) writeJsonAtomically(publishedOutput, artifact);
console.log(
  JSON.stringify({
    output,
    publishedOutput: accepted ? publishedOutput : null,
    improved,
    accepted,
    startingTournament,
    candidateTournament,
    tournament,
  }),
);
