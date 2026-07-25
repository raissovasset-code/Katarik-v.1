export const DEFAULT_ROOM_TTL_MS = 60 * 60 * 1000;
export const DEFAULT_ROOM_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

export function parsePositiveDuration(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function touchRoom(game, now = Date.now()) {
  game.lastActivityAt = now;
}

export function cleanupRooms({
  rooms,
  hasConnectedPlayers,
  now = Date.now(),
  ttlMs = DEFAULT_ROOM_TTL_MS,
}) {
  const removedRoomIds = [];

  for (const [roomId, game] of rooms.entries()) {
    const isEmpty = game.players.length === 0;
    const lastActivityAt = Number(game.lastActivityAt || 0);
    const isExpired =
      !hasConnectedPlayers(roomId) &&
      lastActivityAt > 0 &&
      now - lastActivityAt >= ttlMs;

    if (isEmpty || isExpired) {
      rooms.delete(roomId);
      removedRoomIds.push(roomId);
    }
  }

  return removedRoomIds;
}
