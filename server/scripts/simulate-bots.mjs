import { simulateBotGame } from "../src/bot-simulator.js";

function argument(name, fallback) {
  const entry = process.argv.find((value) => value.startsWith(`--${name}=`));
  return entry ? entry.slice(name.length + 3) : fallback;
}

const mode = argument("mode", "classic");
const games = Number(argument("games", 100));
const players = Number(argument("players", mode === "elimination" ? 3 : 2));
const seed = Number(argument("seed", 1));
if (!["classic", "elimination", "pogoni"].includes(mode))
  throw new Error("Unsupported mode");
if (!Number.isInteger(games) || games <= 0)
  throw new Error("--games must be positive");
if (!Number.isInteger(players) || players < 2 || players > 11)
  throw new Error("--players must be 2–11");

const wins = {};
let turns = 0;
let rounds = 0;
let incomplete = 0;
for (let index = 0; index < games; index += 1) {
  const result = simulateBotGame({
    mode,
    seed: seed + index,
    playerWeights: Array.from({ length: players }),
  });
  turns += result.turns;
  rounds += result.rounds;
  if (!result.completed) incomplete += 1;
  else wins[result.winnerId] = (wins[result.winnerId] || 0) + 1;
}

console.log(
  JSON.stringify(
    {
      mode,
      games,
      players,
      seed,
      incomplete,
      averageTurns: turns / games,
      averageRounds: rounds / games,
      wins,
    },
    null,
    2,
  ),
);
