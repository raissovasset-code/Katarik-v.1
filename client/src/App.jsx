import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3001';

function getTelegramUser() {
  const tg = window.Telegram?.WebApp;
  const u = tg?.initDataUnsafe?.user;
  return {
    id: u?.id ? String(u.id) : localStorage.getItem('katarik_user_id') || crypto.randomUUID(),
    name: u?.first_name || 'Игрок',
  };
}

function App() {
  const user = useMemo(getTelegramUser, []);
  const [ws, setWs] = useState(null);
  const [roomId, setRoomId] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [game, setGame] = useState(null);
  const [selected, setSelected] = useState([]);
  const [error, setError] = useState('');
  const wsRef = useRef(null);

  useEffect(() => {
    localStorage.setItem('katarik_user_id', user.id);
    window.Telegram?.WebApp?.ready?.();
    const socket = new WebSocket(WS_URL);
    wsRef.current = socket;
    setWs(socket);
    socket.onmessage = event => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'roomCreated') setRoomId(msg.roomId);
      if (msg.type === 'state') setGame(msg.game);
      if (msg.type === 'error') setError(msg.message);
    };
    return () => socket.close();
  }, []);

  function send(type, payload = {}) {
    setError('');
    wsRef.current?.send(JSON.stringify({ type, playerId: user.id, name: user.name, ...payload }));
  }

  const me = game?.players?.find(p => p.id === user.id);
  const isMyTurn = game?.currentPlayerId === user.id;

  function toggle(cardId) {
    setSelected(prev => prev.includes(cardId) ? prev.filter(id => id !== cardId) : [...prev, cardId]);
  }

  function play() {
    send('play', { cardIds: selected });
    setSelected([]);
  }

  if (!game) {
    return <main className="screen">
      <h1>Катарик</h1>
      <p className="muted">Онлайн-карточная игра для друзей</p>
      <button onClick={() => send('createRoom')}>Создать комнату</button>
      <div className="join">
        <input value={joinCode} onChange={e => setJoinCode(e.target.value.toUpperCase())} placeholder="Код комнаты" />
        <button onClick={() => send('joinRoom', { roomId: joinCode })}>Войти</button>
      </div>
      {error && <p className="error">{error}</p>}
    </main>;
  }

  return <main className="screen game">
    <header>
      <div>
        <h1>Катарик</h1>
        <p>Комната: <b>{game.roomId}</b></p>
      </div>
      {game.status === 'lobby' && <button onClick={() => send('startGame')}>Начать</button>}
    </header>

    <section className="players">
      {game.players.map(p => <div key={p.id} className={p.id === game.currentPlayerId ? 'player turn' : 'player'}>
        <span>{p.name}</span>
        <b>{p.handCount}</b>
        {!p.active && <small>вышел</small>}
      </div>)}
    </section>

    <section className="table">
      <p className="muted">Стол</p>
      {game.table ? <>
        <div className="cards center">{game.table.cards.map(c => <Card key={c.id} card={c} />)}</div>
        <p>{comboText(game.table.combo)}</p>
      </> : <p>Стол пустой</p>}
    </section>

    {game.status === 'finished' ? <section className="result">
      <h2>Игра окончена</h2>
      <p>Проиграл: {game.players.find(p => p.id === game.loserId)?.name}</p>
    </section> : <>
      <section className="actions">
        <button disabled={!isMyTurn || selected.length === 0} onClick={play}>Походить</button>
        <button disabled={!isMyTurn || !game.table} onClick={() => send('pass')}>Пас</button>
      </section>

      <section className="hand">
        <p>{isMyTurn ? 'Ваш ход' : 'Ждём ход другого игрока'}</p>
        <div className="cards">{me?.hand?.map(card => <Card key={card.id} card={card} selected={selected.includes(card.id)} onClick={() => toggle(card.id)} />)}</div>
      </section>
    </>}

    {error && <p className="error">{error}</p>}
  </main>;
}

function Card({ card, selected, onClick }) {
  const label = card.rank === 'BLACK_JOKER' ? 'Joker ♠' : card.rank === 'RED_JOKER' ? 'Joker ♥' : card.rank === 'DVK' ? 'ДВК' : `${card.rank}${suit(card.suit)}`;
  return <button className={selected ? 'card selected' : 'card'} onClick={onClick}>{label}</button>;
}

function suit(s) {
  return { S: '♠', H: '♥', D: '♦', C: '♣' }[s] || '';
}

function comboText(c) {
  if (!c) return '';
  const map = { single: 'одна карта', pair: 'пара', triple: 'сет', quad: 'каре', straight: 'ряд', doubleStraight: 'двойной ряд' };
  return `${map[c.type] || c.type}, сила ${c.high}`;
}

createRoot(document.getElementById('root')).render(<App />);
