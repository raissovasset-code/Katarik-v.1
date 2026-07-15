import test from 'node:test';
import assert from 'node:assert/strict';

import { claimExistingPlayerSession, createPlayerFromMessage } from './sessions.js';

test('creates a player with a private reconnect token', () => {
  const player = createPlayerFromMessage({
    playerId: 'player-a',
    sessionToken: 'secret-a',
    name: '  Асет  ',
  });

  assert.deepEqual(player, {
    id: 'player-a',
    reconnectToken: 'secret-a',
    name: 'Асет',
  });
});

test('allows reconnect with the matching token', () => {
  const player = { id: 'player-a', reconnectToken: 'secret-a' };

  assert.equal(
    claimExistingPlayerSession(player, {
      playerId: 'player-a',
      sessionToken: 'secret-a',
    }),
    player
  );
});

test('rejects reconnect from another device', () => {
  const player = { id: 'player-a', reconnectToken: 'secret-a' };

  assert.throws(
    () => claimExistingPlayerSession(player, {
      playerId: 'player-a',
      sessionToken: 'secret-b',
    }),
    /другому устройству/
  );
});

test('requires identity and reconnect token for new players', () => {
  assert.throws(
    () => createPlayerFromMessage({ playerId: 'player-a', name: 'Асет' }),
    /Ключ восстановления/
  );
});
