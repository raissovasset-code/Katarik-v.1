import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { addPlayer, createGame, pass, playCards, publicGameState, startGame } from './game.js';

const app = express();
app.use(cors());
app.use(express.json());

const server = app.listen(3001, () => console.log('Katarik server on :3001'));
const wss = new WebSocketServer({ server });
const rooms = new Map();
const sockets = new Map();

function roomCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function send(ws, data) {
  ws.send(JSON.stringify(data));
}

function broadcast(roomId) {
  const game = rooms.get(roomId);
  for (const [ws, meta] of sockets.entries()) {
    if (meta.roomId === roomId) send(ws, { type: 'state', game: publicGameState(game, meta.playerId) });
  }
}

wss.on('connection', ws => {
  sockets.set(ws, {});

  ws.on('message', raw => {
    try {
      const msg = JSON.parse(raw.toString());
      const meta = sockets.get(ws);

      if (msg.type === 'createRoom') {
        const code = roomCode();
        const game = createGame(code);
        rooms.set(code, game);
        const player = { id: msg.playerId, name: msg.name || 'Игрок' };
        addPlayer(game, player);
        sockets.set(ws, { roomId: code, playerId: player.id });
        send(ws, { type: 'roomCreated', roomId: code });
        broadcast(code);
      }

      if (msg.type === 'joinRoom') {
        const game = rooms.get(msg.roomId);
        if (!game) throw new Error('Комната не найдена');
        const player = { id: msg.playerId, name: msg.name || 'Игрок' };
        addPlayer(game, player);
        sockets.set(ws, { roomId: msg.roomId, playerId: player.id });
        broadcast(msg.roomId);
      }

      if (msg.type === 'startGame') {
        const game = rooms.get(meta.roomId);
        startGame(game);
        broadcast(meta.roomId);
      }

      if (msg.type === 'play') {
        const game = rooms.get(meta.roomId);
        playCards(game, meta.playerId, msg.cardIds, msg.declaredRanks || {});
        broadcast(meta.roomId);
      }

      if (msg.type === 'pass') {
        const game = rooms.get(meta.roomId);
        pass(game, meta.playerId);
        broadcast(meta.roomId);
      }
    } catch (e) {
      send(ws, { type: 'error', message: e.message });
    }
  });

  ws.on('close', () => sockets.delete(ws));
});
