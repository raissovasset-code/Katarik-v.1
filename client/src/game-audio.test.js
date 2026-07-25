import { describe, expect, test } from "vitest";
import {
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

  test("reports confirmed play, pass and own turn transitions", () => {
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
      "turn",
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
