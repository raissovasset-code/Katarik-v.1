const ROOM_KEY_PREFIX = 'katarik:room:';

function roomKey(roomId) {
  return `${ROOM_KEY_PREFIX}${roomId}`;
}

function parseRoom(value, key) {
  if (!value) return null;

  try {
    const game = JSON.parse(value);
    if (!game || typeof game.roomId !== 'string' || !Array.isArray(game.players)) {
      throw new Error('invalid room shape');
    }
    return game;
  } catch (error) {
    console.error(`Skipped invalid persisted room ${key}: ${error.message}`);
    return null;
  }
}

export function createMemoryRoomStore() {
  return {
    persistent: false,
    async loadRooms() {
      return new Map();
    },
    async saveRoom() {},
    async deleteRoom() {},
    async close() {},
  };
}

export async function createRedisRoomStore({
  url,
  ttlMs,
  clientFactory = defaultRedisClientFactory,
}) {
  if (!url) return createMemoryRoomStore();

  const client = await clientFactory(url);

  return {
    persistent: true,

    async loadRooms() {
      const rooms = new Map();

      for await (const result of client.scanIterator({ MATCH: `${ROOM_KEY_PREFIX}*` })) {
        const keys = Array.isArray(result) ? result : [result];

        for (const key of keys) {
          const game = parseRoom(await client.get(key), key);
          if (game) rooms.set(game.roomId, game);
        }
      }

      return rooms;
    },

    async saveRoom(game) {
      await client.set(roomKey(game.roomId), JSON.stringify(game), { PX: ttlMs });
    },

    async deleteRoom(roomId) {
      await client.del(roomKey(roomId));
    },

    async close() {
      await client.quit();
    },
  };
}

async function defaultRedisClientFactory(url) {
  const { createClient } = await import('redis');
  const client = createClient({ url });
  client.on('error', error => {
    console.error(`Redis error: ${error.message}`);
  });
  await client.connect();
  return client;
}
