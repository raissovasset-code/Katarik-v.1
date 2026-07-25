import assert from "node:assert/strict";
import test from "node:test";
import { addPlayer, createGame } from "./game.js";
import { createMemoryRoomStore, createRedisRoomStore } from "./room-store.js";
import { claimExistingPlayerSession } from "./sessions.js";

class FakeRedisClient {
  constructor(initial = {}) {
    this.values = new Map(Object.entries(initial));
    this.setCalls = [];
    this.deleted = [];
    this.quitCalled = false;
    this.pingCalls = 0;
  }

  async *scanIterator() {
    yield [...this.values.keys()];
  }

  async get(key) {
    return this.values.get(key) ?? null;
  }

  async set(key, value, options) {
    this.values.set(key, value);
    this.setCalls.push({ key, value, options });
  }

  async del(key) {
    this.values.delete(key);
    this.deleted.push(key);
  }

  async ping() {
    this.pingCalls += 1;
    return "PONG";
  }

  async quit() {
    this.quitCalled = true;
  }
}

test("memory store is a no-op fallback when Redis is not configured", async () => {
  const store = createMemoryRoomStore();
  assert.equal(store.persistent, false);
  assert.equal(await store.isReady(), true);
  assert.deepEqual(await store.loadRooms(), new Map());
  await store.saveRoom({ roomId: "ABC123" });
  await store.deleteRoom("ABC123");
  await store.close();
});

test("Redis readiness checks the live connection", async () => {
  const client = new FakeRedisClient();
  const store = await createRedisRoomStore({
    url: "redis://test",
    ttlMs: 60_000,
    clientFactory: async () => client,
  });

  assert.equal(await store.isReady(), true);
  assert.equal(client.pingCalls, 1);
});

test("loads valid rooms from Redis and skips malformed entries", async () => {
  const client = new FakeRedisClient({
    "katarik:room:ABC123": JSON.stringify({ roomId: "ABC123", players: [] }),
    "katarik:room:BROKEN": "{bad json",
  });
  const store = await createRedisRoomStore({
    url: "redis://test",
    ttlMs: 60_000,
    clientFactory: async () => client,
  });

  const rooms = await store.loadRooms();
  assert.equal(store.persistent, true);
  assert.equal(rooms.size, 1);
  assert.deepEqual(rooms.get("ABC123"), { roomId: "ABC123", players: [] });
});

test("saves the complete room with the configured expiry", async () => {
  const client = new FakeRedisClient();
  const store = await createRedisRoomStore({
    url: "redis://test",
    ttlMs: 3_600_000,
    clientFactory: async () => client,
  });
  const game = { roomId: "ABC123", players: [{ id: "p1" }], status: "lobby" };

  await store.saveRoom(game);

  assert.deepEqual(client.setCalls, [
    {
      key: "katarik:room:ABC123",
      value: JSON.stringify(game),
      options: { PX: 3_600_000 },
    },
  ]);
});

test("deletes a room key and closes the Redis client", async () => {
  const client = new FakeRedisClient({
    "katarik:room:ABC123": JSON.stringify({ roomId: "ABC123", players: [] }),
  });
  const store = await createRedisRoomStore({
    url: "redis://test",
    ttlMs: 60_000,
    clientFactory: async () => client,
  });

  await store.deleteRoom("ABC123");
  await store.close();

  assert.deepEqual(client.deleted, ["katarik:room:ABC123"]);
  assert.equal(client.quitCalled, true);
});

test("restores a room and player session after a simulated server restart", async () => {
  const client = new FakeRedisClient();
  const firstStore = await createRedisRoomStore({
    url: "redis://test",
    ttlMs: 3_600_000,
    clientFactory: async () => client,
  });
  const game = createGame("ABC123");
  addPlayer(game, {
    id: "player-1",
    name: "Игрок",
    reconnectToken: "secret-token",
  });
  game.hostPlayerId = "player-1";
  await firstStore.saveRoom(game);

  const restartedStore = await createRedisRoomStore({
    url: "redis://test",
    ttlMs: 3_600_000,
    clientFactory: async () => client,
  });
  const restoredRooms = await restartedStore.loadRooms();
  const restoredGame = restoredRooms.get("ABC123");
  const restoredPlayer = restoredGame.players[0];

  claimExistingPlayerSession(restoredPlayer, {
    playerId: "player-1",
    sessionToken: "secret-token",
  });

  assert.equal(restoredGame.hostPlayerId, "player-1");
  assert.equal(restoredPlayer.name, "Игрок");
  assert.equal(restoredPlayer.reconnectToken, "secret-token");
});
