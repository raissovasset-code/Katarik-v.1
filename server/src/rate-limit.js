export const RATE_LIMITS = Object.freeze({
  createRoom: { limit: 5, windowMs: 60_000 },
  joinRoom: { limit: 30, windowMs: 60_000 },
  command: { limit: 120, windowMs: 60_000 },
});
export const MAX_RATE_LIMIT_WINDOW_MS = Math.max(
  ...Object.values(RATE_LIMITS).map((policy) => policy.windowMs),
);

const UNLIMITED_MESSAGE_TYPES = new Set(["ping"]);

export class SlidingWindowRateLimiter {
  constructor() {
    this.buckets = new Map();
  }

  consume(key, policy, now = Date.now()) {
    const cutoff = now - policy.windowMs;
    const recent = (this.buckets.get(key) || []).filter(
      (timestamp) => timestamp > cutoff,
    );

    if (recent.length >= policy.limit) {
      this.buckets.set(key, recent);
      return {
        allowed: false,
        retryAfterMs: Math.max(1, recent[0] + policy.windowMs - now),
      };
    }

    recent.push(now);
    this.buckets.set(key, recent);
    return { allowed: true, retryAfterMs: 0 };
  }

  delete(key) {
    this.buckets.delete(key);
  }

  sweep(maxAgeMs, now = Date.now()) {
    const cutoff = now - maxAgeMs;
    for (const [key, timestamps] of this.buckets.entries()) {
      const recent = timestamps.filter((timestamp) => timestamp > cutoff);
      if (recent.length > 0) this.buckets.set(key, recent);
      else this.buckets.delete(key);
    }
  }
}

export function enforceMessageRateLimit(
  limiter,
  message,
  { clientIp, connectionId, now = Date.now() },
) {
  if (UNLIMITED_MESSAGE_TYPES.has(message.type)) return;

  let key;
  let policy;
  let label;

  if (message.type === "createRoom") {
    key = `create:${clientIp}`;
    policy = RATE_LIMITS.createRoom;
    label = "создания комнат";
  } else if (message.type === "joinRoom") {
    key = `join:${clientIp}`;
    policy = RATE_LIMITS.joinRoom;
    label = "входа в комнаты";
  } else {
    key = `command:${connectionId}`;
    policy = RATE_LIMITS.command;
    label = "игровых команд";
  }

  const result = limiter.consume(key, policy, now);
  if (!result.allowed) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil(result.retryAfterMs / 1000),
    );
    throw new Error(
      `Слишком много запросов ${label}. Повторите через ${retryAfterSeconds} сек.`,
    );
  }
}

export function getClientIp(request) {
  const forwarded = request.headers["x-forwarded-for"];
  const firstForwarded = Array.isArray(forwarded)
    ? forwarded[0]
    : forwarded?.split(",")[0];
  return firstForwarded?.trim() || request.socket.remoteAddress || "unknown";
}
