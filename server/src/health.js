export function createHealthSnapshot({ roomStore, rooms }) {
  return {
    name: "Katarik server",
    status: "ok",
    roomStorage: roomStore.persistent ? "redis" : "memory",
    rooms: rooms.size,
  };
}

export async function createReadinessSnapshot({
  roomStore,
  server,
  websocketServer,
}) {
  const checks = {
    roomStorage: false,
    websocket: Boolean(server.listening && websocketServer),
  };

  try {
    checks.roomStorage = await roomStore.isReady();
  } catch {
    checks.roomStorage = false;
  }

  const ready = Object.values(checks).every(Boolean);

  return {
    status: ready ? "ready" : "not_ready",
    checks,
  };
}
