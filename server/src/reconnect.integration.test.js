import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import WebSocket from 'ws';

const TEST_PORT = 32123;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function waitForServer(child, port) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Test server did not start')), 5000);

    child.stdout.on('data', chunk => {
      if (!chunk.toString().includes(`:${port}`)) return;
      clearTimeout(timeout);
      resolve();
    });

    child.once('exit', code => {
      clearTimeout(timeout);
      reject(new Error(`Test server exited with code ${code}`));
    });
  });
}

function openSocket(port = TEST_PORT) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
}

function waitForMessage(socket, type) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${type}`));
    }, 3000);

    function onMessage(raw) {
      const message = JSON.parse(raw.toString());
      if (message.type !== type) return;
      cleanup();
      resolve(message);
    }

    function cleanup() {
      clearTimeout(timeout);
      socket.off('message', onMessage);
    }

    socket.on('message', onMessage);
  });
}

test('a disconnected player reclaims the same room seat', async t => {
  const child = spawn(process.execPath, ['index.js'], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(TEST_PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  t.after(() => child.kill());
  await waitForServer(child, TEST_PORT);

  const identity = {
    playerId: 'reconnect-player',
    sessionToken: 'reconnect-secret',
    name: 'Асет',
  };

  const firstSocket = await openSocket();
  const roomCreated = waitForMessage(firstSocket, 'roomCreated');
  firstSocket.send(JSON.stringify({ type: 'createRoom', mode: 'pogoni', ...identity }));
  const { roomId } = await roomCreated;
  firstSocket.close();

  const secondSocket = await openSocket();
  t.after(() => secondSocket.close());
  const restoredState = waitForMessage(secondSocket, 'state');
  secondSocket.send(JSON.stringify({ type: 'joinRoom', roomId, ...identity }));

  const { game } = await restoredState;
  assert.equal(game.roomId, roomId);
  assert.equal(game.players.length, 1);
  assert.equal(game.players[0].id, identity.playerId);
  assert.equal(game.players[0].name, identity.name);
});

test('only the lobby host can remove another player', async t => {
  const port = TEST_PORT + 2;
  const child = spawn(process.execPath, ['index.js'], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  t.after(() => child.kill());
  await waitForServer(child, port);

  const hostIdentity = {
    playerId: 'kick-host',
    sessionToken: 'kick-host-secret',
    name: 'Host',
  };
  const guestIdentity = {
    playerId: 'kick-guest',
    sessionToken: 'kick-guest-secret',
    name: 'Guest',
  };
  const [hostSocket, guestSocket] = await Promise.all([openSocket(port), openSocket(port)]);

  t.after(() => {
    hostSocket.close();
    guestSocket.close();
  });

  const created = waitForMessage(hostSocket, 'roomCreated');
  hostSocket.send(JSON.stringify({ type: 'createRoom', mode: 'classic', ...hostIdentity }));
  const { roomId } = await created;

  const guestJoined = waitForMessage(guestSocket, 'state');
  guestSocket.send(JSON.stringify({ type: 'joinRoom', roomId, ...guestIdentity }));
  await guestJoined;

  const rejected = waitForMessage(guestSocket, 'error');
  guestSocket.send(JSON.stringify({ type: 'kickPlayer', targetPlayerId: hostIdentity.playerId }));
  assert.match((await rejected).message, /Хозяин|хозяин/);

  const kicked = waitForMessage(guestSocket, 'kicked');
  const hostState = waitForMessage(hostSocket, 'state');
  hostSocket.send(JSON.stringify({ type: 'kickPlayer', targetPlayerId: guestIdentity.playerId }));

  assert.match((await kicked).message, /удалил/);
  const { game } = await hostState;
  assert.deepEqual(game.players.map(player => player.id), [hostIdentity.playerId]);
});

test('a pogoni room keeps a leaving host gray and moves host rights clockwise', async t => {
  const port = TEST_PORT + 1;
  const child = spawn(process.execPath, ['index.js'], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  t.after(() => child.kill());
  await waitForServer(child, port);

  const identities = ['A', 'B', 'C'].map(id => ({
    playerId: id,
    sessionToken: `secret-${id}`,
    name: id,
  }));
  const [hostSocket, secondSocket, thirdSocket] = await Promise.all([
    openSocket(port),
    openSocket(port),
    openSocket(port),
  ]);

  t.after(() => {
    hostSocket.close();
    secondSocket.close();
    thirdSocket.close();
  });

  const created = waitForMessage(hostSocket, 'roomCreated');
  hostSocket.send(JSON.stringify({ type: 'createRoom', mode: 'pogoni', ...identities[0] }));
  const { roomId } = await created;

  const secondJoined = waitForMessage(secondSocket, 'state');
  secondSocket.send(JSON.stringify({ type: 'joinRoom', roomId, ...identities[1] }));
  await secondJoined;

  const secondSeesThird = waitForMessage(secondSocket, 'state');
  const thirdJoined = waitForMessage(thirdSocket, 'state');
  thirdSocket.send(JSON.stringify({ type: 'joinRoom', roomId, ...identities[2] }));
  await Promise.all([secondSeesThird, thirdJoined]);

  const started = waitForMessage(secondSocket, 'state');
  hostSocket.send(JSON.stringify({ type: 'startGame' }));
  const beforeLeave = (await started).game;
  assert.equal(beforeLeave.status, 'playing');
  assert.equal(beforeLeave.players.length, 3);

  const hostLeft = waitForMessage(hostSocket, 'leftRoom');
  const continued = waitForMessage(secondSocket, 'state');
  hostSocket.send(JSON.stringify({ type: 'leaveRoom' }));

  await hostLeft;
  const afterLeave = (await continued).game;
  assert.equal(afterLeave.status, 'playing');
  assert.deepEqual(afterLeave.players.map(player => player.id), ['A', 'B', 'C']);
  assert.equal(afterLeave.players.find(player => player.id === 'A').leaving, true);
  assert.equal(afterLeave.hostPlayerId, 'B');
  assert.notEqual(afterLeave.currentPlayerId, 'A');

  const rejectedSocket = await openSocket(port);
  t.after(() => rejectedSocket.close());
  const rejected = waitForMessage(rejectedSocket, 'error');
  rejectedSocket.send(JSON.stringify({ type: 'joinRoom', roomId, ...identities[0] }));
  assert.match((await rejected).message, /покинули/);
});
