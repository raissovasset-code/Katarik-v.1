import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import WebSocket from 'ws';

const TEST_PORT = 32123;
const SERVER_URL = `ws://127.0.0.1:${TEST_PORT}`;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Test server did not start')), 5000);

    child.stdout.on('data', chunk => {
      if (!chunk.toString().includes(`:${TEST_PORT}`)) return;
      clearTimeout(timeout);
      resolve();
    });

    child.once('exit', code => {
      clearTimeout(timeout);
      reject(new Error(`Test server exited with code ${code}`));
    });
  });
}

function openSocket() {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(SERVER_URL);
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
  await waitForServer(child);

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
