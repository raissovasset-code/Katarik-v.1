import test from "node:test";
import assert from "node:assert/strict";

import { checkProduction } from "./production-monitor.js";

class HealthyWebSocket {
  constructor(url) {
    this.url = url;
    this.listeners = new Map();
    queueMicrotask(() => this.emit("open"));
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  emit(type, data) {
    this.listeners.get(type)?.(data);
  }

  send(raw) {
    assert.deepEqual(JSON.parse(raw), { type: "ping" });
    queueMicrotask(() => {
      this.emit("message", { data: JSON.stringify({ type: "pong" }) });
    });
  }

  close() {}
}

function readyResponse(overrides = {}) {
  return {
    ok: true,
    status: 200,
    async json() {
      return {
        status: "ready",
        checks: { roomStorage: true, websocket: true },
        ...overrides,
      };
    },
  };
}

test("production monitor checks readiness and WebSocket heartbeat", async () => {
  let requestedUrl;
  const result = await checkProduction({
    baseUrl: "https://example.test/",
    fetchImpl: async (url) => {
      requestedUrl = url;
      return readyResponse();
    },
    WebSocketImpl: HealthyWebSocket,
  });

  assert.equal(requestedUrl, "https://example.test/api/ready");
  assert.deepEqual(result, {
    status: "ready",
    readinessUrl: "https://example.test/api/ready",
    websocketUrl: "wss://example.test",
  });
});

test("production monitor rejects an HTTP readiness failure", async () => {
  await assert.rejects(
    checkProduction({
      baseUrl: "https://example.test",
      fetchImpl: async () => ({ ok: false, status: 503 }),
      WebSocketImpl: HealthyWebSocket,
    }),
    /HTTP 503/,
  );
});

test("production monitor rejects incomplete readiness checks", async () => {
  await assert.rejects(
    checkProduction({
      baseUrl: "https://example.test",
      fetchImpl: async () =>
        readyResponse({
          status: "not_ready",
          checks: { roomStorage: false, websocket: true },
        }),
      WebSocketImpl: HealthyWebSocket,
    }),
    /not ready/,
  );
});
