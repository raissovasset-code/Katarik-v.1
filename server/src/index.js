import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addPlayer,
  createGame,
  nextRound,
  pass,
  playCards,
  publicGameState,
  removePlayer,
  restartGame,
  startGame,
} from './game.js';
import { claimExistingPlayerSession, createPlayerFromMessage } from './sessions.js';
import {
  cleanupRooms,
  DEFAULT_ROOM_CLEANUP_INTERVAL_MS,
  DEFAULT_ROOM_TTL_MS,
  parsePositiveDuration,
  touchRoom,
} from './room-cleanup.js';
import { createRedisRoomStore } from './room-store.js';
import { parseClientMessage } from './message-validation.js';
import {
  enforceMessageRateLimit,
  getClientIp,
  MAX_RATE_LIMIT_WINDOW_MS,
  SlidingWindowRateLimiter,
} from './rate-limit.js';

const PORT = Number(process.env.PORT || 3001);
const ROOM_TTL_MS = parsePositiveDuration(process.env.ROOM_TTL_MS, DEFAULT_ROOM_TTL_MS);
const ROOM_CLEANUP_INTERVAL_MS = parsePositiveDuration(
  process.env.ROOM_CLEANUP_INTERVAL_MS,
  DEFAULT_ROOM_CLEANUP_INTERVAL_MS,
);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDistPath = path.resolve(__dirname, '../../client/dist');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(clientDistPath));

const roomStore = await createRedisRoomStore({
  url: process.env.REDIS_URL,
  ttlMs: ROOM_TTL_MS,
});
const rooms = await roomStore.loadRooms();
const sockets = new Map();
const playerSockets = new Map();
const messageRateLimiter = new SlidingWindowRateLimiter();
let nextConnectionId = 1;

if (roomStore.persistent) {
  console.log(`Restored ${rooms.size} rooms from Redis`);
} else {
  console.warn('REDIS_URL is not configured; rooms will not survive a server restart');
}

function playerSocketKey(roomId, playerId) {
  return `${roomId}:${playerId}`;
}

function hasConnectedPlayers(roomId) {
  for (const meta of sockets.values()) {
    if (meta.roomId === roomId) return true;
  }
  return false;
}

app.get('/api/health', (req, res) => {
  res.json({
    name: 'Katarik server',
    status: 'ok',
    roomStorage: roomStore.persistent ? 'redis' : 'memory',
    rooms: rooms.size,
  });
});

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) {
    next();
    return;
  }

  res.sendFile(path.join(clientDistPath, 'index.html'), error => {
    if (error) next();
  });
});

const server = app.listen(PORT, () => {
  console.log(`Katarik server on :${PORT}`);
});

const wss = new WebSocketServer({ server });

const roomCleanupTimer = setInterval(async () => {
  try {
    const removedRoomIds = cleanupRooms({
      rooms,
      hasConnectedPlayers,
      ttlMs: ROOM_TTL_MS,
    });

    await Promise.all(removedRoomIds.map(roomId => roomStore.deleteRoom(roomId)));
    messageRateLimiter.sweep(MAX_RATE_LIMIT_WINDOW_MS);

    if (removedRoomIds.length > 0) {
      console.log(`Removed ${removedRoomIds.length} expired rooms`);
    }
  } catch (error) {
    console.error(`Room cleanup failed: ${error.message}`);
  }
}, ROOM_CLEANUP_INTERVAL_MS);
roomCleanupTimer.unref?.();

async function persistRoom(game) {
  touchRoom(game);
  await roomStore.saveRoom(game);
}

function roomCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function sendTo(ws, data) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(data));
  }
}

function bindPlayerSocket(ws, roomId, playerId) {
  const key = playerSocketKey(roomId, playerId);
  const oldWs = playerSockets.get(key);

  if (oldWs && oldWs !== ws) {
    try {
      oldWs.close();
    } catch {
      // Ignore stale socket close errors.
    }
    sockets.delete(oldWs);
  }

  playerSockets.set(key, ws);
  sockets.set(ws, { roomId, playerId });
}

function broadcast(roomId) {
  const game = rooms.get(roomId);
  if (!game) return;

  for (const [ws, meta] of sockets.entries()) {
    if (meta.roomId === roomId) {
      sendTo(ws, {
        type: 'state',
        game: publicGameState(game, meta.playerId),
      });
    }
  }
}

function requireRoom(meta) {
  const game = rooms.get(meta?.roomId);
  if (!game) throw new Error('Комната не найдена');
  return game;
}

function requireHost(game, playerId) {
  if (game.hostPlayerId !== playerId) {
    throw new Error('Только хозяин комнаты может управлять игрой');
  }
}

async function leaveRoom(ws) {
  const meta = sockets.get(ws);
  const roomId = meta?.roomId;
  const playerId = meta?.playerId;
  const game = roomId ? rooms.get(roomId) : null;

  const socketKey = roomId && playerId ? playerSocketKey(roomId, playerId) : null;

  if (socketKey && playerSockets.get(socketKey) === ws) {
    playerSockets.delete(socketKey);
  }

  sockets.set(ws, {});

  if (game && playerId) {
    const result = removePlayer(game, playerId);

    if (result.empty) {
      rooms.delete(roomId);
      await roomStore.deleteRoom(roomId);
    } else {
      await persistRoom(game);
      broadcast(roomId);
    }
  }

  sendTo(ws, { type: 'leftRoom' });
}

async function handleCreateRoom(ws, msg) {
  const code = roomCode();
  const game = createGame(code, msg.mode || 'classic');
  const player = createPlayerFromMessage(msg);

  rooms.set(code, game);
  addPlayer(game, player);
  game.hostPlayerId = player.id;
  bindPlayerSocket(ws, code, player.id);
  await persistRoom(game);

  sendTo(ws, { type: 'roomCreated', roomId: code });
  broadcast(code);
}

async function handleJoinRoom(ws, msg) {
  const roomId = String(msg.roomId || '').trim().toUpperCase();
  const game = rooms.get(roomId);
  if (!game) throw new Error('Комната не найдена');

  const existingPlayer = game.players.find(player => player.id === msg.playerId);

  if (existingPlayer) {
    if (existingPlayer.leaving) {
      throw new Error('Вы уже покинули эту игру');
    }
    claimExistingPlayerSession(existingPlayer, msg);
    bindPlayerSocket(ws, roomId, existingPlayer.id);
    await persistRoom(game);
    broadcast(roomId);
    return;
  }

  if (game.status !== 'lobby') {
    throw new Error('Игра уже началась');
  }

  const player = createPlayerFromMessage(msg);
  addPlayer(game, player);
  bindPlayerSocket(ws, roomId, player.id);
  await persistRoom(game);
  broadcast(roomId);
}

async function handleHostAction(ws, meta, action) {
  const game = requireRoom(meta);
  requireHost(game, meta.playerId);
  action(game);
  await persistRoom(game);
  broadcast(meta.roomId);
}

async function handleKickPlayer(ws, meta, msg) {
  const game = requireRoom(meta);
  requireHost(game, meta.playerId);

  if (game.status !== 'lobby') {
    throw new Error('Удалять игроков можно только до начала игры');
  }

  const targetPlayerId = String(msg.targetPlayerId || '');
  if (!targetPlayerId || !game.players.some(player => player.id === targetPlayerId)) {
    throw new Error('Игрок не найден');
  }
  if (targetPlayerId === meta.playerId) {
    throw new Error('Хозяин комнаты не может удалить себя');
  }

  const targetKey = playerSocketKey(meta.roomId, targetPlayerId);
  const targetSocket = playerSockets.get(targetKey);
  const result = removePlayer(game, targetPlayerId);

  if (!result.removed) {
    throw new Error('Игрок не найден');
  }

  await persistRoom(game);

  if (targetSocket) {
    playerSockets.delete(targetKey);
    sockets.set(targetSocket, {});
    sendTo(targetSocket, {
      type: 'kicked',
      message: 'Хозяин комнаты удалил вас из комнаты.',
    });
  }

  broadcast(meta.roomId);
}

async function handlePlayerAction(ws, meta, action) {
  const game = requireRoom(meta);

  if (game.currentPlayerId !== meta.playerId) {
    throw new Error('Сейчас ход другого игрока');
  }

  action(game);
  await persistRoom(game);
  broadcast(meta.roomId);
}

wss.on('connection', (ws, request) => {
  const connectionId = nextConnectionId;
  nextConnectionId += 1;
  const clientIp = getClientIp(request);
  sockets.set(ws, {});

  ws.on('message', async raw => {
    try {
      const msg = parseClientMessage(raw);
      enforceMessageRateLimit(messageRateLimiter, msg, {
        clientIp,
        connectionId,
      });
      const meta = sockets.get(ws);
      const game = meta?.roomId ? rooms.get(meta.roomId) : null;

      if (msg.type === 'ping') {
        if (game) await persistRoom(game);
        sendTo(ws, { type: 'pong', timestamp: Date.now() });
        return;
      }

      if (msg.type === 'createRoom') {
        await handleCreateRoom(ws, msg);
        return;
      }

      if (msg.type === 'joinRoom') {
        await handleJoinRoom(ws, msg);
        return;
      }

      if (msg.type === 'leaveRoom') {
        await leaveRoom(ws);
        return;
      }

      if (msg.type === 'kickPlayer') {
        await handleKickPlayer(ws, meta, msg);
        return;
      }

      if (msg.type === 'startGame') {
        await handleHostAction(ws, meta, startGame);
        return;
      }

      if (msg.type === 'restartGame') {
        await handleHostAction(ws, meta, restartGame);
        return;
      }

      if (msg.type === 'nextRound') {
        await handleHostAction(ws, meta, nextRound);
        return;
      }

      if (msg.type === 'play') {
        await handlePlayerAction(ws, meta, game => {
          playCards(game, meta.playerId, msg.cardIds, msg.declaredRanks || {});
        });
        return;
      }

      if (msg.type === 'pass') {
        await handlePlayerAction(ws, meta, game => pass(game, meta.playerId));
        return;
      }
    } catch (error) {
      sendTo(ws, { type: 'error', message: error.message });
    }
  });

  ws.on('close', () => {
    messageRateLimiter.delete(`command:${connectionId}`);
    const meta = sockets.get(ws);
    const socketKey = meta?.roomId && meta?.playerId
      ? playerSocketKey(meta.roomId, meta.playerId)
      : null;

    if (socketKey && playerSockets.get(socketKey) === ws) {
      playerSockets.delete(socketKey);
    }

    const game = meta?.roomId ? rooms.get(meta.roomId) : null;
    if (game) {
      persistRoom(game).catch(error => {
        console.error(`Failed to persist disconnected room: ${error.message}`);
      });
    }

    sockets.delete(ws);
  });
});
