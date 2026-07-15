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
  restartGame,
  startGame,
} from './game.js';
import { claimExistingPlayerSession, createPlayerFromMessage } from './sessions.js';

const PORT = Number(process.env.PORT || 3001);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDistPath = path.resolve(__dirname, '../../client/dist');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(clientDistPath));

const rooms = new Map();
const sockets = new Map();
const playerSockets = new Map();

function playerSocketKey(roomId, playerId) {
  return `${roomId}:${playerId}`;
}

app.get('/', (req, res) => {
  res.json({
    name: 'Katarik server',
    status: 'ok',
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

function leaveRoom(ws) {
  const meta = sockets.get(ws);
  const roomId = meta?.roomId;
  const playerId = meta?.playerId;
  const game = roomId ? rooms.get(roomId) : null;

  const socketKey = roomId && playerId ? playerSocketKey(roomId, playerId) : null;

  if (socketKey && playerSockets.get(socketKey) === ws) {
    playerSockets.delete(socketKey);
  }

  sockets.set(ws, {});

  if (game?.status === 'lobby') {
    game.players = game.players.filter(player => player.id !== playerId);

    if (game.hostPlayerId === playerId) {
      game.hostPlayerId = game.players[0]?.id || null;
    }

    if (game.players.length === 0) {
      rooms.delete(roomId);
    } else {
      broadcast(roomId);
    }
  }

  sendTo(ws, { type: 'leftRoom' });
}

function handleCreateRoom(ws, msg) {
  const code = roomCode();
  const game = createGame(code, msg.mode || 'classic');
  const player = createPlayerFromMessage(msg);

  rooms.set(code, game);
  addPlayer(game, player);
  game.hostPlayerId = player.id;
  bindPlayerSocket(ws, code, player.id);

  sendTo(ws, { type: 'roomCreated', roomId: code });
  broadcast(code);
}

function handleJoinRoom(ws, msg) {
  const roomId = String(msg.roomId || '').trim().toUpperCase();
  const game = rooms.get(roomId);
  if (!game) throw new Error('Комната не найдена');

  const existingPlayer = game.players.find(player => player.id === msg.playerId);

  if (existingPlayer) {
    claimExistingPlayerSession(existingPlayer, msg);
    bindPlayerSocket(ws, roomId, existingPlayer.id);
    broadcast(roomId);
    return;
  }

  if (game.status !== 'lobby') {
    throw new Error('Игра уже началась');
  }

  const player = createPlayerFromMessage(msg);
  addPlayer(game, player);
  bindPlayerSocket(ws, roomId, player.id);
  broadcast(roomId);
}

function handleHostAction(ws, meta, action) {
  const game = requireRoom(meta);
  requireHost(game, meta.playerId);
  action(game);
  broadcast(meta.roomId);
}

function handlePlayerAction(ws, meta, action) {
  const game = requireRoom(meta);

  if (game.currentPlayerId !== meta.playerId) {
    throw new Error('Сейчас ход другого игрока');
  }

  action(game);
  broadcast(meta.roomId);
}

wss.on('connection', ws => {
  sockets.set(ws, {});

  ws.on('message', raw => {
    try {
      const msg = JSON.parse(raw.toString());
      const meta = sockets.get(ws);

      if (msg.type === 'ping') {
        sendTo(ws, { type: 'pong', timestamp: Date.now() });
        return;
      }

      if (msg.type === 'createRoom') {
        handleCreateRoom(ws, msg);
        return;
      }

      if (msg.type === 'joinRoom') {
        handleJoinRoom(ws, msg);
        return;
      }

      if (msg.type === 'leaveRoom') {
        leaveRoom(ws);
        return;
      }

      if (msg.type === 'startGame') {
        handleHostAction(ws, meta, startGame);
        return;
      }

      if (msg.type === 'restartGame') {
        handleHostAction(ws, meta, restartGame);
        return;
      }

      if (msg.type === 'nextRound') {
        handleHostAction(ws, meta, nextRound);
        return;
      }

      if (msg.type === 'play') {
        handlePlayerAction(ws, meta, game => {
          playCards(game, meta.playerId, msg.cardIds, msg.declaredRanks || {});
        });
        return;
      }

      if (msg.type === 'pass') {
        handlePlayerAction(ws, meta, game => pass(game, meta.playerId));
      }
    } catch (error) {
      sendTo(ws, { type: 'error', message: error.message });
    }
  });

  ws.on('close', () => {
    const meta = sockets.get(ws);
    const socketKey = meta?.roomId && meta?.playerId
      ? playerSocketKey(meta.roomId, meta.playerId)
      : null;

    if (socketKey && playerSockets.get(socketKey) === ws) {
      playerSockets.delete(socketKey);
    }

    sockets.delete(ws);
  });
});
