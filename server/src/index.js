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
  .card {
  width: 58px;
  height: 82px;
  background: white;
  color: #111;
  border-radius: 10px;
  border: 2px solid #ddd;
  font-size: 20px;
  font-weight: bold;
  margin: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.card.red {
  color: #dc2626;
}

.card.selected {
  background: #f59e0b !important;
  transform: translateY(-14px);
  border: 3px solid #fff;
}
  </style>
</head>
<body>
  <h1>Катарик</h1>

  <input id="name" placeholder="Твоё имя" />
  <div class="box">
  <b>Режим игры</b><br><br>

  <label>
    <input type="radio" name="mode" value="classic" checked>
    Обычный
  </label><br>

  <label>
    <input type="radio" name="mode" value="elimination">
    На вылет
  </label><br>

  <label>
    <input type="radio" name="mode" value="pogoni">
    Погоны
  </label>
</div>
  <button onclick="createRoom()">Создать комнату</button>

  <input id="room" placeholder="Код комнаты" />
  <button onclick="joinRoom()">Войти в комнату</button>

  <div class="box" id="status">Не подключено</div>
  <div class="box" id="game"></div>

<script>
const playerId = sessionStorage.playerId || (sessionStorage.playerId = Math.random().toString(36).slice(2));
let selectedCards = [];

const ws = new WebSocket(
  location.protocol === "https:" 
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
    selectedCards = [];

    const players = msg.game.players.map(p =>
      "- " + p.name + " — карт: " + (p.handCount ?? 0)
    ).join("<br>");

const currentPlayer = msg.game.players.find(p => p.id === msg.game.currentPlayerId);
const turnText = currentPlayer ? currentPlayer.name : "не определён";
const tableCards = msg.game.table?.cards
  ? msg.game.table.cards.map(c => {

      const suitMap = {
        H: "♥",
        D: "♦",
        C: "♣",
        S: "♠"
      };

      const label =
        c.rank === "BLACK_JOKER"
  ? "<span style='color:black'>🃏♠</span>"
: c.rank === "RED_JOKER"
  ? "<span style='color:red'>🃏♥</span>"
        : c.rank === "DVK"
          ? "⭐"
        : c.rank + (suitMap[c.suit] || "");

      return "<span class='card " +
        ((c.suit === "H" || c.suit === "D") ? "red" : "") +
        "'>" + label + "</span>";

    }).join(" ")
  : "Пусто";

    const myCards = msg.game.hand
? msg.game.hand.map((c, i) => {
const cardId = c.rank + (c.suit || "");
const suitMap = {
  H: "♥",
  D: "♦",
  C: "♣",
  S: "♠"
};

const label =
  c.rank === "BLACK_JOKER"
    ? "<span style='color:black'>🃏</span>"
  : c.rank === "RED_JOKER"
    ? "<span style='color:red'>🃏</span>"
  : c.rank === "DVK"
    ? "⭐"
  : c.rank + (suitMap[c.suit] || "");
return "<button class='card " + ((c.suit === "H" || c.suit === "D") ? "red" : "") + "' onclick='toggleCard(\\"" + cardId + "\\", " + i + ")' id='card_" + i + "'>" + label + "</button>";
}).join(" ")
: "";

    const prettyCard = (card) => {
  if (card === "BLACK_JOKER") return "🃏";
  if (card === "RED_JOKER") return "🃏";
  if (card === "DVK") return "⭐";

  const suitMap = {
    H: "♥",
    D: "♦",
    C: "♣",
    S: "♠"
  };

  const rank = card.slice(0, -1);
  const suit = card.slice(-1);

  return rank + suitMap[suit];
};
    const winners = msg.game.places?.length
  ? "<b>Вышли:</b><br>" +
    msg.game.places.map((id, index) => {
      const p = msg.game.players.find(x => x.id === id);
      return (index + 1) + ". " + (p?.name || "Игрок");
    }).join("<br>") + "<br><br>"
  : "";

const loser = msg.game.loserId
  ? (() => {
      const p = msg.game.players.find(x => x.id === msg.game.loserId);
      return "<div style='color:#ef4444;font-size:22px;font-weight:bold'>Проиграл: " +
        (p?.name || "Игрок") +
        "</div><br>";
    })()
  : "";
    document.getElementById("game").innerHTML =
      "<b>Комната:</b> " + (msg.game.roomId || msg.game.id || document.getElementById("room").value) + "<br><br>" +
      "<b>Статус:</b> " + msg.game.status + "<br><br>" +
      winners +
loser +
      "<b>Ходит:</b> " + turnText + "<br><br>" +
      "<b>Игроки:</b><br>" + players + "<br><br>" +
      "<b>Стол:</b><br>" + tableCards + "<br><br>" +
      (
        msg.game.status === "lobby"
          ? "<button onclick='startGame()'>Начать игру</button>"
          : "<b>Мои карты:</b><br>" + myCards + "<br><br><button onclick='playSelected()'>Походить</button>" +
"<button onclick='passTurn()'>Пас</button>"
      );
  }

  if (msg.type === "error") {
    alert(msg.message);
  }
};

function createRoom() {
  const mode = document.querySelector('input[name="mode"]:checked').value;

  send({
    type: "createRoom",
    playerId,
    name: document.getElementById("name").value || "Игрок",
    mode
  });
}

function joinRoom() {
  send({
    type: "joinRoom",
    playerId,
    name: document.getElementById("name").value || "Игрок",
    roomId: document.getElementById("room").value.trim().toUpperCase()
  });
}

function startGame() {
  send({ type: "startGame" });
}

function toggleCard(cardId, index) {
  const pos = selectedCards.indexOf(cardId);

  if (pos >= 0) {
    selectedCards.splice(pos, 1);
    document.getElementById("card_" + index).classList.remove("selected");
  } else {
    selectedCards.push(cardId);
    document.getElementById("card_" + index).classList.add("selected");
  }
}

function playSelected() {
  send({
    type: "play",
    cardIds: selectedCards
  });

  selectedCards = [];
}

function passTurn() {
  send({
    type: "pass"
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

function sendTo(ws, data) {
  ws.send(JSON.stringify(data));
}

function broadcast(roomId) {
  const game = rooms.get(roomId);
  if (!game) return;

  for (const [ws, meta] of sockets.entries()) {
    if (meta.roomId === roomId) {
      sendTo(ws, {
        type: 'state',
        game: publicGameState(game, meta.playerId)
      });
    }
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

        sendTo(ws, { type: 'roomCreated', roomId: code });
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
        if (!game) throw new Error('Комната не найдена');

        startGame(game);
        broadcast(meta.roomId);
      }

      if (msg.type === 'play') {
        const game = rooms.get(meta.roomId);
        if (!game) throw new Error('Комната не найдена');
        if (game.currentPlayerId !== meta.playerId) {
  throw new Error('Сейчас ход другого игрока');
}

        playCards(game, meta.playerId, msg.cardIds, msg.declaredRanks || {});
        broadcast(meta.roomId);
      }

      if (msg.type === 'pass') {
        const game = rooms.get(meta.roomId);
        if (!game) throw new Error('Комната не найдена');
        if (game.currentPlayerId !== meta.playerId) {
  throw new Error('Сейчас ход другого игрока');
}

        pass(game, meta.playerId);
        broadcast(meta.roomId);
      }
    } catch (e) {
      sendTo(ws, { type: 'error', message: e.message });
    }
  });

  ws.on('close', () => sockets.delete(ws));
});
