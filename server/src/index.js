import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { addPlayer, createGame, pass, playCards, publicGameState, startGame } from './game.js';

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.type("html").send(`
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Катарик</title>
  <style>
    body { font-family: Arial; padding: 20px; background:#111; color:white; }
    button, input { width:100%; padding:14px; margin:8px 0; font-size:18px; border-radius:10px; }
    button { background:#22c55e; border:0; font-weight:bold; }
    input { box-sizing:border-box; }
    .box { background:#222; padding:15px; border-radius:12px; margin-top:15px; }
  </style>
</head>
<body>
  <h1>Катарик</h1>

  <input id="name" placeholder="Твоё имя" />

  <button onclick="createRoom()">Создать комнату</button>

  <input id="room" placeholder="Код комнаты" />
  <button onclick="joinRoom()">Войти в комнату</button>

  <div class="box" id="status">Не подключено</div>
  <div class="box" id="game"></div>

<script>
const playerId = sessionStorage.playerId || (sessionStorage.playerId = Math.random().toString(36).slice(2));
const ws = new WebSocket(location.protocol === "https:" 
  ? "wss://" + location.host 
  : "ws://" + location.host
);

function send(data) {
  ws.send(JSON.stringify(data));
}

ws.onopen = () => {
  document.getElementById("status").innerText = "Подключено к серверу";
};

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);

  if (msg.type === "roomCreated") {
    document.getElementById("room").value = msg.roomId;
    document.getElementById("status").innerText = "Комната создана: " + msg.roomId;
  }

  if (msg.type === "state") {
  document.getElementById("game").innerHTML =
    "<b>Комната:</b> " + (msg.game.roomId || msg.game.id || document.getElementById("room").value) + "<br><br>" +
    "<b>Игроки:</b><br>" +
    msg.game.players.map(p => "- " + p.name).join("<br>") +
    "<br><br><button onclick='startGame()'>Начать игру</button>";
}

  if (msg.type === "error") {
    alert(msg.message);
  }
};

function createRoom() {
  send({
    type: "createRoom",
    playerId,
    name: document.getElementById("name").value || "Игрок"
  });
}

function joinRoom() {
  send({
    type: "joinRoom",
    playerId,
    name: document.getElementById("name").value || "Игрок",
    roomId: document.getElementById("room").value.toUpperCase()
  });
}

function startGame() {
  send({
    type: "startGame"
  });
}

</script>
</body>
</html>
  `);
});

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

  try {
    startGame(game);
    broadcast(meta.roomId);
  } catch (e) {
    send(ws, {
      type: 'error',
      message: 'Ошибка старта: ' + e.message
    });
  }
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
