import test from "node:test";
import assert from "node:assert/strict";

import { createHealthSnapshot, createReadinessSnapshot } from "./health.js";

test("health snapshot reports process and storage information", () => {
  const snapshot = createHealthSnapshot({
    roomStore: { persistent: true },
    rooms: new Map([["ROOM", {}]]),
  });

  assert.deepEqual(snapshot, {
    name: "Katarik server",
    status: "ok",
    roomStorage: "redis",
    rooms: 1,
  });
});

test("readiness requires storage and WebSocket server", async () => {
  const snapshot = await createReadinessSnapshot({
    roomStore: { isReady: async () => true },
    server: { listening: true },
    websocketServer: {},
  });

  assert.deepEqual(snapshot, {
    status: "ready",
    checks: { roomStorage: true, websocket: true },
  });
});

test("readiness fails safely when storage is unavailable", async () => {
  const snapshot = await createReadinessSnapshot({
    roomStore: {
      isReady: async () => {
        throw new Error("storage unavailable");
      },
    },
    server: { listening: true },
    websocketServer: {},
  });

  assert.deepEqual(snapshot, {
    status: "not_ready",
    checks: { roomStorage: false, websocket: true },
  });
});
