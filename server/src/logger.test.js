import test from "node:test";
import assert from "node:assert/strict";

import { createLogger, errorContext } from "./logger.js";

test("logger writes one structured JSON entry", () => {
  const output = [];
  const logger = createLogger({
    now: () => new Date("2026-07-25T12:00:00.000Z"),
    write: (level, line) => output.push({ level, line }),
  });

  logger.info("room_created", {
    roomId: "ABC123",
    mode: "classic",
    players: 1,
  });

  assert.deepEqual(output, [
    {
      level: "info",
      line: JSON.stringify({
        timestamp: "2026-07-25T12:00:00.000Z",
        level: "info",
        event: "room_created",
        roomId: "ABC123",
        mode: "classic",
        players: 1,
      }),
    },
  ]);
});

test("logger drops cards, tokens, payloads, and unknown metadata", () => {
  const output = [];
  const logger = createLogger({
    write: (level, line) => output.push(JSON.parse(line)),
  });

  logger.warn("unsafe_context_test", {
    roomId: "ABC123",
    cards: ["AS"],
    hand: ["KH"],
    reconnectToken: "private-token",
    sessionToken: "private-session",
    payload: { cardIds: ["AS"] },
    unknown: "not allowed",
  });

  assert.deepEqual(Object.keys(output[0]).sort(), [
    "event",
    "level",
    "roomId",
    "timestamp",
  ]);
  assert.equal(JSON.stringify(output[0]).includes("private"), false);
  assert.equal(JSON.stringify(output[0]).includes("AS"), false);
});

test("error context exposes classification without the error message", () => {
  const error = new Error("redis://user:secret@example.test");
  error.code = "ECONNREFUSED";

  assert.deepEqual(errorContext(error), {
    errorName: "Error",
    errorCode: "ECONNREFUSED",
  });
});
