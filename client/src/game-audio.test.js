import { describe, expect, test } from "vitest";
import {
  createGameAudio,
  getGameSounds,
  isMoveErrorMessage,
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

  test("reports the start of every new round", () => {
    expect(
      getGameSounds(
        game({ roundNumber: 1 }),
        game({ roundNumber: 2 }),
        "player-1",
      ),
    ).toEqual(["roundStart"]);
    expect(
      getGameSounds(
        game({ status: "lobby", roundNumber: 0 }),
        game({ roundNumber: 1 }),
        "player-1",
      ),
    ).toEqual(["roundStart"]);
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

    expect(
      getGameSounds(
        game(),
        game({
          table: {
            playerId: "player-2",
            cards: [{ id: "BLACK_JOKER", rank: "BLACK_JOKER" }],
            combo: { type: "single" },
          },
        }),
        "player-1",
      ),
    ).toEqual(["blackJoker"]);
    expect(
      getGameSounds(
        game(),
        game({
          table: {
            playerId: "player-2",
            cards: [{ id: "RED_JOKER", rank: "RED_JOKER" }],
            combo: { type: "single" },
          },
        }),
        "player-1",
      ),
    ).toEqual(["redJoker"]);
  });

  test("uses the supplied card sample once for a single card", () => {
    const played = [];
    class Audio {
      constructor(source) {
        this.source = source;
      }

      play() {
        played.push({
          source: this.source,
          currentTime: this.currentTime,
          volume: this.volume,
        });
        return Promise.resolve();
      }
    }

    const audio = createGameAudio(undefined, Audio);
    audio.play("cards");

    expect(played).toEqual([
      {
        source: "/audio/card-hit.mp3",
        currentTime: 0,
        volume: 0.9,
      },
    ]);
  });

  test("repeats the supplied sample quickly for pairs and every card in a straight", () => {
    const played = [];
    const scheduled = [];
    class Audio {
      constructor(source) {
        this.source = source;
      }

      play() {
        played.push(this.source);
        return Promise.resolve();
      }
    }
    const schedule = (callback, delay) => scheduled.push({ callback, delay });
    const audio = createGameAudio(undefined, Audio, schedule);

    audio.play("pair");
    expect(played).toEqual(["/audio/card-hit.mp3"]);
    expect(scheduled.map(({ delay }) => delay)).toEqual([100]);
    scheduled.shift().callback();
    expect(played).toHaveLength(2);

    played.length = 0;
    scheduled.length = 0;
    audio.play("row:5");
    expect(played).toEqual(["/audio/card-hit.mp3"]);
    expect(scheduled.map(({ delay }) => delay)).toEqual([90, 180, 270, 360]);
    scheduled.forEach(({ callback }) => callback());
    expect(played).toHaveLength(5);
  });

  test("plays the approved MP3 asset for a bomb", () => {
    const played = [];
    class Audio {
      constructor(source) {
        this.source = source;
        this.currentTime = 10;
        this.volume = 0;
      }

      play() {
        played.push({
          source: this.source,
          currentTime: this.currentTime,
          volume: this.volume,
        });
        return Promise.resolve();
      }
    }

    const audio = createGameAudio(undefined, Audio);
    audio.play("bomb");

    expect(played).toEqual([
      {
        source: "/audio/bomb.mp3",
        currentTime: 0,
        volume: 0.95,
      },
    ]);
  });

  test("plays the supplied MP3 asset for three equal cards", () => {
    const played = [];
    class Audio {
      constructor(source) {
        this.source = source;
      }

      play() {
        played.push({
          source: this.source,
          currentTime: this.currentTime,
          volume: this.volume,
        });
        return Promise.resolve();
      }
    }

    const audio = createGameAudio(undefined, Audio);
    audio.play("triple");

    expect(played).toEqual([
      {
        source: "/audio/triple.mp3",
        currentTime: 0,
        volume: 0.95,
      },
    ]);
  });

  test.each([
    ["quad", "/audio/quad.mp3"],
    ["pass", "/audio/pass.mp3"],
    ["roundStart", "/audio/round-start.mp3"],
    ["moveError", "/audio/move-error.mp3"],
  ])("plays the supplied MP3 asset for %s", (effect, source) => {
    const played = [];
    class Audio {
      constructor(audioSource) {
        this.source = audioSource;
      }

      play() {
        played.push({
          source: this.source,
          currentTime: this.currentTime,
          volume: this.volume,
        });
        return Promise.resolve();
      }
    }

    const audio = createGameAudio(undefined, Audio);
    audio.play(effect);

    expect(played).toEqual([{ source, currentTime: 0, volume: 0.95 }]);
  });

  test("recognizes only errors related to a move", () => {
    [
      "Сейчас ход другого игрока",
      "Недопустимая комбинация",
      "Эта комбинация не бьет стол",
      "Нельзя сыграть одну карту дважды",
      "Карты не найдены в руке",
      "Нельзя оставлять ДВК без обычной карты",
      "Неверный список карт",
      "Нельзя пасовать первым ходом",
      "Игра не идет",
    ].forEach((message) => expect(isMoveErrorMessage(message)).toBe(true));

    expect(isMoveErrorMessage("Комната не найдена")).toBe(false);
    expect(isMoveErrorMessage("Соединение потеряно")).toBe(false);
  });

  test("plays the trimmed laugh only for the black joker", () => {
    const played = [];
    class Audio {
      constructor(source) {
        this.source = source;
      }

      play() {
        played.push({
          source: this.source,
          currentTime: this.currentTime,
          volume: this.volume,
        });
        return Promise.resolve();
      }
    }

    const audio = createGameAudio(undefined, Audio);
    audio.play("blackJoker");

    expect(played).toEqual([
      {
        source: "/audio/black-joker-laugh.mp3",
        currentTime: 0,
        volume: 0.95,
      },
    ]);
  });

  test("plays the approved sound only for the red joker", () => {
    const played = [];
    class Audio {
      constructor(source) {
        this.source = source;
      }

      play() {
        played.push({
          source: this.source,
          currentTime: this.currentTime,
          volume: this.volume,
        });
        return Promise.resolve();
      }
    }

    const audio = createGameAudio(undefined, Audio);
    audio.play("redJoker");

    expect(played).toEqual([
      {
        source: "/audio/red-joker-sound.mp3",
        currentTime: 0,
        volume: 0.95,
      },
    ]);
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
