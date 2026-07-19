import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryRoomStore, createRedisRoomStore } from './room-store.js';

class FakeRedisClient {
  constructor(initial = {}) {
    this.values = new Map(Object.entries(initial));
    this.setCalls = [];
    this.deleted = [];
    this.quitCalled = false;
  }

  async *scanIterator() {
    yield* this.values.keys();
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

  async quit() {
    this.quitCalled = true;
  }
}

test('memory store is a no-op fallback when Redis is not configured', async () => {
  const store = createMemoryRoomStore();
  assert.equal(store.persistent, false);
  assert.deepEqual(await store.loadRooms(), new Map());
  await store.saveRoom({ roomId: 'ABC123' });
  await store.deleteRoom('ABC123');
  await store.close();
});

test('loads valid rooms from Redis and skips malformed entries', async () => {
  const client = new FakeRedisClient({
    'katarik:room:ABC123': JSON.stringify({ roomId: 'ABC123', players: [] }),
    'katarik:room:BROKEN': '{bad json',
  });
  const store = await createRedisRoomStore({
    url: 'redis://test',
    ttlMs: 60_000,
    clientFactory: async () => client,
  });

  const rooms = await store.loadRooms();
  assert.equal(store.persistent, true);
  assert.equal(rooms.size, 1);
  assert.deepEqual(rooms.get('ABC123'), { roomId: 'ABC123', players: [] });
});

test('saves the complete room with the configured expiry', async () => {
  const client = new FakeRedisClient();
  const store = await createRedisRoomStore({
    url: 'redis://test',
    ttlMs: 3_600_000,
    clientFactory: async () => client,
  });
  const game = { roomId: 'ABC123', players: [{ id: 'p1' }], status: 'lobby' };

  await store.saveRoom(game);

  assert.deepEqual(client.setCalls, [{
    key: 'katarik:room:ABC123',
    value: JSON.stringify(game),
    options: { PX: 3_600_000 },
  }]);
});

test('deletes a room key and closes the Redis client', async () => {
  const client = new FakeRedisClient({
    'katarik:room:ABC123': JSON.stringify({ roomId: 'ABC123', players: [] }),
  });
  const store = await createRedisRoomStore({
    url: 'redis://test',
    ttlMs: 60_000,
    clientFactory: async () => client,
  });

  await store.deleteRoom('ABC123');
  await store.close();

  assert.deepEqual(client.deleted, ['katarik:room:ABC123']);
  assert.equal(client.quitCalled, true);
});
