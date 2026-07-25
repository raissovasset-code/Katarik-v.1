import assert from "node:assert/strict";
import test from "node:test";
import {
  parseClientMessage,
  validateClientMessage,
} from "./message-validation.js";

const identity = {
  playerId: "player-1",
  sessionToken: "session-token",
  name: "Игрок",
};

test("accepts every supported command with valid fields", () => {
  const messages = [
    { type: "ping" },
    { type: "createRoom", mode: "classic", ...identity },
    { type: "joinRoom", roomId: "ABC123", ...identity },
    { type: "addBot" },
    { type: "leaveRoom" },
    { type: "kickPlayer", targetPlayerId: "player-2" },
    { type: "startGame" },
    { type: "restartGame" },
    { type: "nextRound" },
    { type: "play", cardIds: ["4S", "DVK"], declaredRanks: { DVK: "5" } },
    { type: "pass" },
  ];

  for (const message of messages)
    assert.equal(validateClientMessage(message), message);
});

test("rejects malformed JSON and non-object messages", () => {
  assert.throws(() => parseClientMessage("{bad"), /некорректный JSON/);
  assert.throws(() => validateClientMessage(null), /должно быть объектом/);
  assert.throws(() => validateClientMessage([]), /должно быть объектом/);
});

test("rejects missing and unknown message types", () => {
  assert.throws(() => validateClientMessage({}), /Неизвестный тип/);
  assert.throws(
    () => validateClientMessage({ type: "deleteEverything" }),
    /Неизвестный тип/,
  );
});

test("validates create-room identity and mode", () => {
  assert.throws(
    () =>
      validateClientMessage({
        type: "createRoom",
        mode: "classic",
        ...identity,
        playerId: "",
      }),
    /Идентификатор игрока/,
  );
  assert.throws(
    () =>
      validateClientMessage({
        type: "createRoom",
        mode: "invalid",
        ...identity,
      }),
    /Неизвестный режим/,
  );
  assert.throws(
    () =>
      validateClientMessage({
        type: "createRoom",
        mode: "classic",
        ...identity,
        name: 123,
      }),
    /Имя игрока/,
  );
});

test("validates join-room identity and six-character room code", () => {
  assert.throws(
    () =>
      validateClientMessage({ type: "joinRoom", roomId: "ABC", ...identity }),
    /Некорректный код/,
  );
  assert.throws(
    () =>
      validateClientMessage({
        type: "joinRoom",
        roomId: "ABC-12",
        ...identity,
      }),
    /Некорректный код/,
  );
  assert.throws(
    () =>
      validateClientMessage({
        type: "joinRoom",
        roomId: "ABC123",
        ...identity,
        sessionToken: "",
      }),
    /Ключ восстановления/,
  );
});

test("validates kick target", () => {
  assert.throws(
    () => validateClientMessage({ type: "kickPlayer", targetPlayerId: "" }),
    /удаляемого игрока/,
  );
});

test("validates played card ids and declared ranks", () => {
  assert.throws(
    () => validateClientMessage({ type: "play", cardIds: [] }),
    /непустой список/,
  );
  assert.throws(
    () => validateClientMessage({ type: "play", cardIds: ["4S", "4S"] }),
    /повторения/,
  );
  assert.throws(
    () =>
      validateClientMessage({
        type: "play",
        cardIds: ["DVK"],
        declaredRanks: [],
      }),
    /должны быть объектом/,
  );
  assert.throws(
    () =>
      validateClientMessage({
        type: "play",
        cardIds: ["DVK"],
        declaredRanks: { DVK: "JOKER" },
      }),
    /недопустимое значение/,
  );
});
