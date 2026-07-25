import { describe, expect, test } from "vitest";
import {
  createGameAudio,
  getGameSounds,
  readSoundEnabled,
  SOUND_STORAGE_KEY,
  writeSoundEnabled,
} from "./game-audio.js";

function game(overrides = {}) {
  return {
    mode: "classic",
    status: "playing",
    currentPlayerId: "player-2",
    passedPlayerIds: [],
    table: null,
    ...overrides,
  };
}

describe("game audio", () => {
  test("keeps sound enabled by default and persists mute choice", () => {
    const values = new Map();
    const storage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    };

    expect(readSoundEnabled(storage)).toBe(true);
    writeSoundEnabled(false, storage);
    expect(values.get(SOUND_STORAGE_KEY)).toBe("false");
    expect(readSoundEnabled(storage)).toBe(false);
  });

  test("reports confirmed play and pass without an immediate turn sound", () => {
    const previous = game();
    const next = game({
      currentPlayerId: "player-1",
      passedPlayerIds: ["player-3"],
      table: {
        playerId: "player-2",
        cards: [{ id: "5S" }],
      },
    });

    expect(getGameSounds(previous, next, "player-1")).toEqual([
      "pass",
      "cards",
    ]);
    expect(
      getGameSounds(
        game({ table: next.table, passedPlayerIds: ["player-1"] }),
        game({ currentPlayerId: "player-2" }),
        "player-1",
      ),
    ).toEqual(["pass"]);
  });

  test("does not replay a card sound for an unchanged table", () => {
    const table = { playerId: "player-2", cards: [{ id: "5S" }] };

    expect(getGameSounds(game({ table }), game({ table }), "player-1")).toEqual(
      [],
    );
  });

  test("maps every supported combination to its own sound", () => {
    const soundFor = (type, cardCount) =>
      getGameSounds(
        game(),
        game({
          table: {
            playerId: "player-2",
            cards: Array.from({ length: cardCount }, (_, index) => ({
              id: `${type}-${index}`,
            })),
            combo: { type },
          },
        }),
        "player-1",
      );

    expect(soundFor("single", 1)).toEqual(["cards"]);
    expect(soundFor("pair", 2)).toEqual(["pair"]);
    expect(soundFor("straight", 5)).toEqual(["row:5"]);
    expect(soundFor("triple", 3)).toEqual(["triple"]);
    expect(soundFor("quad", 4)).toEqual(["quad"]);
    expect(soundFor("doubleStraight", 8)).toEqual(["bomb"]);
  });

  test("repeats the card sound for pairs and every card in a straight", async () => {
    const starts = [];
    class AudioContext {
      constructor() {
        this.currentTime = 0;
        this.destination = {};
        this.state = "running";
      }

      createOscillator() {
        return {
          connect() {},
          frequency: { setValueAtTime() {} },
          start: () => starts.push(true),
          stop() {},
          type: "sine",
        };
      }

      createGain() {
        return {
          connect() {},
          gain: {
            exponentialRampToValueAtTime() {},
            setValueAtTime() {},
          },
        };
      }
    }

    const audio = createGameAudio(AudioContext);
    audio.play("pair");
    await Promise.resolve();
    await Promise.resolve();
    expect(starts).toHaveLength(4);

    starts.length = 0;
    audio.play("row:5");
    await Promise.resolve();
    await Promise.resolve();
    expect(starts).toHaveLength(10);
  });

  test("distinguishes victory and defeat in the final state", () => {
    expect(
      getGameSounds(
        game(),
        game({ status: "finished", loserId: "player-2" }),
        "player-1",
      ),
    ).toEqual(["win"]);
    expect(
      getGameSounds(
        game(),
        game({ status: "finished", loserId: "player-1" }),
        "player-1",
      ),
    ).toEqual(["lose"]);
  });
});
