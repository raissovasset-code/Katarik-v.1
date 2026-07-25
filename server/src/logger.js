const ALLOWED_CONTEXT_KEYS = new Set([
  "errorCode",
  "errorName",
  "mode",
  "players",
  "port",
  "removedRooms",
  "roomId",
  "rooms",
  "storage",
]);

function sanitizeContext(context) {
  const sanitized = {};

  for (const [key, value] of Object.entries(context)) {
    if (!ALLOWED_CONTEXT_KEYS.has(key)) continue;
    if (!["boolean", "number", "string"].includes(typeof value)) continue;
    sanitized[key] = value;
  }

  return sanitized;
}

function defaultWrite(level, line) {
  const stream = level === "error" ? process.stderr : process.stdout;
  stream.write(`${line}\n`);
}

export function errorContext(error) {
  return {
    errorName: error?.name || "Error",
    ...(typeof error?.code === "string" ? { errorCode: error.code } : {}),
  };
}

export function createLogger({
  now = () => new Date(),
  write = defaultWrite,
} = {}) {
  function emit(level, event, context = {}) {
    const entry = {
      timestamp: now().toISOString(),
      level,
      event,
      ...sanitizeContext(context),
    };
    write(level, JSON.stringify(entry));
  }

  return {
    info(event, context) {
      emit("info", event, context);
    },
    warn(event, context) {
      emit("warn", event, context);
    },
    error(event, context) {
      emit("error", event, context);
    },
  };
}

export const logger = createLogger();
