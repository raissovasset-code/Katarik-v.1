import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { evaluateWeights, createSeededRandom } from "../src/bot-simulator.js";
import { DEFAULT_BOT_WEIGHTS } from "../src/bot-strategy.js";

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

function mutate(weights, random, scale) {
  return Object.fromEntries(
    Object.entries(weights).map(([key, value]) => {
      const magnitude = Math.max(Math.abs(value) * scale, scale * 10);
      return [
        key,
        Math.round((value + (random() * 2 - 1) * magnitude) * 100) / 100,
      ];
    }),
  );
}

const games = positiveInteger("games", 120);
const generations = positiveInteger("generations", 6);
const candidates = positiveInteger("candidates", 6);
const seed = positiveInteger("seed", 20260719);
const output = path.resolve(
  argument("output", path.join(__dirname, "../src/trained-bot-weights.json")),
);
const random = createSeededRandom(seed);

let champion = { ...DEFAULT_BOT_WEIGHTS };
let accepted = 0;
const history = [];

for (let generation = 1; generation <= generations; generation += 1) {
  const scale = Math.max(0.04, 0.22 * (1 - (generation - 1) / generations));
  let best = null;
  for (let index = 0; index < candidates; index += 1) {
    const candidate = mutate(champion, random, scale);
    const result = evaluateWeights({
      candidate,
      baseline: champion,
      games,
      seed: seed + generation * 100_000 + index * games,
    });
    if (!best || result.winRate > best.result.winRate)
      best = { weights: candidate, result };
  }

  const validation = evaluateWeights({
    candidate: best.weights,
    baseline: champion,
    games: games * 2,
    seed: seed + 5_000_000 + generation * games * 2,
  });
  const improved = validation.winRate >= 0.52 && validation.incomplete === 0;
  if (improved) {
    champion = best.weights;
    accepted += 1;
  }
  history.push({ generation, improved, training: best.result, validation });
  console.log(
    JSON.stringify({ generation, improved, training: best.result, validation }),
  );
}

const verification = evaluateWeights({
  candidate: champion,
  baseline: DEFAULT_BOT_WEIGHTS,
  games: games * 5,
  seed: seed + 9_000_000,
});

const artifact = {
  version: 1,
  trainedAt: new Date().toISOString(),
  seed,
  gamesPerCandidate: games,
  generations,
  candidatesPerGeneration: candidates,
  acceptedGenerations: accepted,
  verification,
  weights: champion,
  history,
};

fs.writeFileSync(output, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ output, verification }));
