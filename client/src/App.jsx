import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3001';

function getTelegramUser() {
  const tg = window.Telegram?.WebApp;

  if (tg) {
    tg.ready?.();
    tg.expand?.();
  }

  const u = tg?.initDataUnsafe?.user;

  return {
    id: u?.id ? String(u.id) : localStorage.getItem('katarik_user_id') || crypto.randomUUID(),
    name: u?.first_name || localStorage.getItem('katarik_name') || 'Игрок',
  };
}

function App() {
  const user = useMemo(getTelegramUser, []);
  const [roomId, setRoomId] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [name, setName] = useState(user.name);
  const [mode, setMode] = useState('classic');
  const [game, setGame] = useState(null);
  const [selected, setSelected] = useState([]);
  const [error, setError] = useState('');
  const wsRef = useRef(null);

  useEffect(() => {
    localStorage.setItem('katarik_user_id', user.id);
    localStorage.setItem('katarik_name', name);
  }, [user.id, name]);

  useEffect(() => {
    const socket = new WebSocket(WS_URL);
    wsRef.current = socket;

    socket.onmessage = event => {
      const msg = JSON.parse(event.data);

      if (msg.type === 'roomCreated') {
        setRoomId(msg.roomId);
        setJoinCode(msg.roomId);
        localStorage.setItem('katarik_room', msg.roomId);
      }

      if (msg.type === 'state') {
        setGame(msg.game);
      }

      if (msg.type === 'error') {
        setError(msg.message);
      }
    };

    socket.onclose = () => {
      setError('Соединение потеряно. Обнови игру.');
    };

    return () => socket.close();
  }, []);

  function send(type, payload = {}) {
    setError('');

    wsRef.current?.send(JSON.stringify({
      type,
      playerId: user.id,
      name: name || user.name,
      ...payload,
    }));
  }

  function createRoom() {
    send('createRoom', { mode });
  }

  function joinRoom() {
    const code = joinCode.trim().toUpperCase();
    if (!code) return;

    localStorage.setItem('katarik_room', code);
    send('joinRoom', { roomId: code });
  }

  function toggle(cardId) {
    setSelected(prev =>
      prev.includes(cardId)
        ? prev.filter(id => id !== cardId)
        : [...prev, cardId]
    );
  }

  function play() {
    send('play', { cardIds: selected });
    setSelected([]);
  }

  const me = game?.players?.find(p => p.id === user.id);
  const isMyTurn = game?.currentPlayerId === user.id;
  const currentPlayer = game?.players?.find(p => p.id === game.currentPlayerId);

  if (!game) {
    return (
      <main className="welcome">
        <div className="brand">
          <div className="brand-cards">♠ ♥ ♦ ♣</div>
          <h1>Катарик</h1>
          <p>Онлайн-карточная игра для друзей</p>
        </div>

        <section className="panel">
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Твоё имя"
          />

          <div className="mode-grid">
            <button className={mode === 'classic' ? 'active' : ''} onClick={() => setMode('classic')}>
              Обычный
            </button>
            <button className={mode === 'elimination' ? 'active' : ''} onClick={() => setMode('elimination')}>
              На вылет
            </button>
            <button className={mode === 'pogoni' ? 'active' : ''} onClick={() => setMode('pogoni')}>
              Погоны
            </button>
          </div>

          <button className="primary" onClick={createRoom}>Создать комнату</button>

          <div className="join-row">
            <input
              value={joinCode}
              onChange={e => setJoinCode(e.target.value.toUpperCase())}
              placeholder="Код комнаты"
            />
            <button onClick={joinRoom}>Войти</button>
          </div>

          {error && <div className="toast error">{error}</div>}
        </section>
      </main>
    );
  }

  return (
    <main className="game-screen">
      <header className="topbar">
        <div>
          <div className="room-label">Комната</div>
          <b>{game.roomId}</b>
        </div>

        <div className="top-actions">
          <span>{modeName(game.mode)}</span>
          {game.status === 'lobby' && (
            <button onClick={() => send('startGame')}>Начать</button>
          )}
          {game.status === 'round_finished' && (
            <button onClick={() => send('nextRound')}>Следующий кон</button>
          )}
          {game.status === 'finished' && (
            <button onClick={() => send('restartGame')}>Играть заново</button>
          )}
        </div>
      </header>

      <section className="table-shell">
        <div className="opponents">
          {game.players
            .filter(p => p.id !== user.id)
            .map((p, index) => (
              <PlayerBadge
                key={p.id}
                player={p}
                game={game}
                position={index}
              />
            ))}
        </div>

        <div className="turn-pill">
          Ходит: <b>{currentPlayer?.name || '—'}</b>
        </div>

        <div className="table-cards">
          {game.table?.cards?.length ? (
            game.table.cards.map((card, i) => (
              <Card key={card.id} card={card} table index={i} />
            ))
          ) : (
            <div className="empty-table">Стол пустой</div>
          )}
        </div>

        {game.table?.combo && (
          <div className="combo-pill">{comboText(game.table.combo)}</div>
        )}

        {game.status === 'finished' && (
          <div className="result-card">
            <h2>Игра окончена</h2>
            <p>Проиграл: {game.players.find(p => p.id === game.loserId)?.name || '—'}</p>
          </div>
        )}
      </section>

      <section className="my-zone">
        <div className="me-badge">
          <span>{me?.name || name}</span>
          <b>{me?.handCount ?? 0} карт</b>
          {game.mode === 'pogoni' && <small>Погон: {me?.pogonRank}</small>}
        </div>

        <div className="hand-fan">
          {game.hand?.map((card, index) => (
            <Card
              key={card.id}
              card={card}
              selected={selected.includes(card.id)}
              onClick={() => toggle(card.id)}
              index={index}
              total={game.hand.length}
            />
          ))}
        </div>

        <div className="action-bar">
          <button disabled={!isMyTurn || selected.length === 0} onClick={play}>
            Походить
          </button>
          <button disabled={!isMyTurn || !game.table} onClick={() => send('pass')}>
            Пас
          </button>
        </div>

        <div className={isMyTurn ? 'hint your-turn' : 'hint'}>
          {isMyTurn ? 'Ваш ход' : 'Ждём ход другого игрока'}
        </div>
      </section>

      {error && <div className="toast error floating">{error}</div>}
    </main>
  );
}

function PlayerBadge({ player, game, position }) {
  const isTurn = player.id === game.currentPlayerId;
  const eliminated = game.eliminatedIds?.includes(player.id);

  return (
    <div className={`opponent opponent-${position} ${isTurn ? 'turn' : ''} ${eliminated ? 'eliminated' : ''}`}>
      <div className="avatar">{player.name?.[0] || '?'}</div>
      <div>
        <b>{player.name}</b>
        <span>{eliminated ? 'вылетел' : `${player.handCount ?? 0} карт`}</span>
        {game.mode === 'pogoni' && <small>Погон: {player.pogonRank}</small>}
      </div>
    </div>
  );
}

function Card({ card, selected, onClick, table, index = 0, total = 1 }) {
  const red = card.suit === 'H' || card.suit === 'D';
  const label = cardLabel(card);

  const fanOffset = total > 1 ? index - (total - 1) / 2 : 0;

  const style = table
    ? { transform: `rotate(${(index - 1) * 7}deg)` }
    : { transform: `translateX(${fanOffset * -10}px) rotate(${fanOffset * 3}deg)` };

  return (
    <button
      className={`playing-card ${red ? 'red' : ''} ${selected ? 'selected' : ''} ${table ? 'table-card' : ''}`}
      onClick={onClick}
      style={style}
    >
      <span>{label}</span>
    </button>
  );
}

function cardLabel(card) {
  if (card.rank === 'BLACK_JOKER') return '🃏♠';
  if (card.rank === 'RED_JOKER') return '🃏♥';
  if (card.rank === 'DVK') return '⭐';

  return `${card.rank}${suit(card.suit)}`;
}

function suit(s) {
  return { S: '♠', H: '♥', D: '♦', C: '♣' }[s] || '';
}

function comboText(c) {
  if (!c) return '';

  const map = {
    single: 'одна карта',
    pair: 'пара',
    triple: 'сет',
    quad: 'каре',
    straight: 'ряд',
    doubleStraight: 'двойной ряд',
  };

  return map[c.type] || c.type;
}

function modeName(mode) {
  if (mode === 'elimination') return 'На вылет';
  if (mode === 'pogoni') return 'Погоны';
  return 'Обычный';
}

createRoot(document.getElementById('root')).render(<App />);
