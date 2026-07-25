import assert from "node:assert/strict";
import test from "node:test";
import {
  enforceMessageRateLimit,
  getClientIp,
  RATE_LIMITS,
  SlidingWindowRateLimiter,
} from "./rate-limit.js";

test("blocks requests after the configured sliding-window limit", () => {
  const limiter = new SlidingWindowRateLimiter();
  const policy = { limit: 2, windowMs: 1_000 };

  assert.equal(limiter.consume("key", policy, 100).allowed, true);
  assert.equal(limiter.consume("key", policy, 200).allowed, true);
  assert.deepEqual(limiter.consume("key", policy, 300), {
    allowed: false,
    retryAfterMs: 800,
  });
  assert.equal(limiter.consume("key", policy, 1_101).allowed, true);
});

test("keeps create, join and command limits independent", () => {
  const limiter = new SlidingWindowRateLimiter();
  const context = {
    clientIp: "203.0.113.10",
    connectionId: "socket-1",
    now: 100,
  };

  for (let index = 0; index < RATE_LIMITS.createRoom.limit; index += 1) {
    enforceMessageRateLimit(limiter, { type: "createRoom" }, context);
  }
  assert.throws(
    () => enforceMessageRateLimit(limiter, { type: "createRoom" }, context),
    /Слишком много запросов создания комнат/,
  );

  assert.doesNotThrow(() =>
    enforceMessageRateLimit(limiter, { type: "joinRoom" }, context),
  );
  assert.doesNotThrow(() =>
    enforceMessageRateLimit(limiter, { type: "pass" }, context),
  );
});

test("does not rate-limit heartbeat messages", () => {
  const limiter = new SlidingWindowRateLimiter();
  const context = {
    clientIp: "203.0.113.10",
    connectionId: "socket-1",
    now: 100,
  };

  for (let index = 0; index < 1_000; index += 1) {
    enforceMessageRateLimit(limiter, { type: "ping" }, context);
  }

  assert.equal(limiter.buckets.size, 0);
});

test("sweeps expired buckets and removes connection buckets", () => {
  const limiter = new SlidingWindowRateLimiter();
  limiter.consume("old", { limit: 2, windowMs: 1_000 }, 100);
  limiter.consume("active", { limit: 2, windowMs: 1_000 }, 1_500);
  limiter.sweep(1_000, 2_000);

  assert.equal(limiter.buckets.has("old"), false);
  assert.equal(limiter.buckets.has("active"), true);
  limiter.delete("active");
  assert.equal(limiter.buckets.has("active"), false);
});

test("uses the first forwarded address and falls back to the socket address", () => {
  assert.equal(
    getClientIp({
      headers: { "x-forwarded-for": "198.51.100.5, 10.0.0.1" },
      socket: { remoteAddress: "127.0.0.1" },
    }),
    "198.51.100.5",
  );
  assert.equal(
    getClientIp({
      headers: {},
      socket: { remoteAddress: "127.0.0.1" },
    }),
    "127.0.0.1",
  );
});
