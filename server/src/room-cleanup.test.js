import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_ROOM_TTL_MS,
  cleanupRooms,
  parsePositiveDuration,
  touchRoom,
} from "./room-cleanup.js";

function room(players = [{}], lastActivityAt = 1_000) {
  return { players, lastActivityAt };
}

test("removes an empty room immediately", () => {
  const rooms = new Map([["EMPTY", room([], 9_900)]]);
  const removed = cleanupRooms({
    rooms,
    hasConnectedPlayers: () => false,
    now: 10_000,
    ttlMs: 5_000,
  });

  assert.deepEqual(removed, ["EMPTY"]);
  assert.equal(rooms.size, 0);
});

test("removes an expired room without connected players", () => {
  const rooms = new Map([["STALE", room([{}], 1_000)]]);
  const removed = cleanupRooms({
    rooms,
    hasConnectedPlayers: () => false,
    now: 6_000,
    ttlMs: 5_000,
  });

  assert.deepEqual(removed, ["STALE"]);
  assert.equal(rooms.size, 0);
});

test("keeps a recently active room", () => {
  const rooms = new Map([["RECENT", room([{}], 2_000)]]);
  const removed = cleanupRooms({
    rooms,
    hasConnectedPlayers: () => false,
    now: 6_999,
    ttlMs: 5_000,
  });

  assert.deepEqual(removed, []);
  assert.equal(rooms.has("RECENT"), true);
});

test("keeps an expired room while a player is connected", () => {
  const rooms = new Map([["ACTIVE", room([{}], 1_000)]]);
  const removed = cleanupRooms({
    rooms,
    hasConnectedPlayers: (roomId) => roomId === "ACTIVE",
    now: 20_000,
    ttlMs: 5_000,
  });

  assert.deepEqual(removed, []);
  assert.equal(rooms.has("ACTIVE"), true);
});

test("touchRoom records activity using the supplied clock", () => {
  const game = {};
  touchRoom(game, 42);
  assert.equal(game.lastActivityAt, 42);
});

test("parsePositiveDuration rejects invalid and non-positive values", () => {
  assert.equal(parsePositiveDuration("2500", DEFAULT_ROOM_TTL_MS), 2_500);
  assert.equal(
    parsePositiveDuration("invalid", DEFAULT_ROOM_TTL_MS),
    DEFAULT_ROOM_TTL_MS,
  );
  assert.equal(
    parsePositiveDuration("0", DEFAULT_ROOM_TTL_MS),
    DEFAULT_ROOM_TTL_MS,
  );
  assert.equal(
    parsePositiveDuration("-5", DEFAULT_ROOM_TTL_MS),
    DEFAULT_ROOM_TTL_MS,
  );
});
