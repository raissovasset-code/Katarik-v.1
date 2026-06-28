import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

function defaultWsUrl() {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const host = isLocal ? `${window.location.hostname}:3001` : window.location.host;

  return `${protocol}://${host}`;
}

const WS_URL = import.meta.env.VITE_WS_URL || defaultWsUrl();
const DESKTOP_GAME_WIDTH = 1600;
const DESKTOP_GAME_HEIGHT = 900;
const MIN_DESKTOP_SCALE = 0.72;

function createLocalUser() {
  const savedId = sessionStorage.getItem('katarik_user_id');
  const id = savedId || createId();

  if (!savedId) {
    sessionStorage.setItem('katarik_user_id', id);
  }

  return {
    id,
    name: localStorage.getItem('katarik_name') || 'Игрок',
  };
}

function createId() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return `player_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function getRoomFromUrl() {
  return new URLSearchParams(window.location.search).get('room')?.trim().toUpperCase() || '';
}

function getLayoutFromUrl() {
  const forcedView = new URLSearchParams(window.location.search).get('view');

  if (forcedView === 'mobile' || forcedView === 'desktop') {
    return forcedView;
  }

  return isLikelyMobileDevice() ? 'mobile' : 'desktop';
}

function isLikelyMobileDevice() {
  const userAgent = navigator.userAgent || '';
  const hasMobileUserAgent = /Android|iPhone|iPad|iPod|Mobile|IEMobile|Opera Mini/i.test(userAgent);
  const hasTouch = navigator.maxTouchPoints > 1;
  const hasCoarsePointer = window.matchMedia?.('(pointer: coarse)').matches;
  const narrowScreen = Math.min(window.screen.width, window.screen.height) <= 820;

  return hasMobileUserAgent || (hasTouch && hasCoarsePointer && narrowScreen);
}

function roomPath(roomId) {
  const params = new URLSearchParams(window.location.search);
  params.set('room', roomId);

  return `${window.location.pathname}?${params.toString()}`;
}

function App() {
  const user = useMemo(createLocalUser, []);
  const initialRoom = useMemo(getRoomFromUrl, []);
  const initialLayout = useMemo(getLayoutFromUrl, []);
  const [joinCode, setJoinCode] = useState(initialRoom);
  const [name, setName] = useState(user.name);
  const [mode, setMode] = useState('classic');
  const [game, setGame] = useState(null);
  const [selected, setSelected] = useState([]);
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [viewport, setViewport] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  const wsRef = useRef(null);

  useEffect(() => {
    localStorage.setItem('katarik_name', name);
  }, [name]);

  useEffect(() => {
    function updateViewport() {
      setViewport({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    }

    window.addEventListener('resize', updateViewport);
    return () => window.removeEventListener('resize', updateViewport);
  }, []);

  useEffect(() => {
    const socket = new WebSocket(WS_URL);
    wsRef.current = socket;

    socket.onopen = () => setConnected(true);

    socket.onmessage = event => {
      const msg = JSON.parse(event.data);

      if (msg.type === 'roomCreated') {
        setJoinCode(msg.roomId);
        localStorage.setItem('katarik_room', msg.roomId);
        window.history.replaceState(null, '', roomPath(msg.roomId));
      }

      if (msg.type === 'state') {
        setGame(msg.game);
        setSelected([]);
      }

      if (msg.type === 'leftRoom') {
        setGame(null);
        setSelected([]);
        setJoinCode('');
        localStorage.removeItem('katarik_room');
        window.history.replaceState(null, '', window.location.pathname);
      }

      if (msg.type === 'error') {
        setError(msg.message);
      }
    };

    socket.onclose = () => {
      setConnected(false);
      setError('Соединение потеряно. Обнови страницу.');
    };

    return () => socket.close();
  }, []);

  function send(type, payload = {}) {
    setError('');

    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      setError('Нет соединения с сервером.');
      return;
    }

    wsRef.current.send(JSON.stringify({
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

    setJoinCode(code);
    localStorage.setItem('katarik_room', code);
    window.history.replaceState(null, '', roomPath(code));
    send('joinRoom', { roomId: code });
  }

  async function copyInvite() {
    const roomId = game?.roomId || joinCode;
    if (!roomId) return;

    const inviteUrl = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
    await navigator.clipboard.writeText(inviteUrl);
    setInviteCopied(true);
    window.setTimeout(() => setInviteCopied(false), 1500);
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

  function leaveRoom() {
    send('leaveRoom');
  }

  const me = game?.players?.find(p => p.id === user.id);
  const isMyTurn = game?.currentPlayerId === user.id;
  const isHost = game?.hostPlayerId === user.id;
  const currentPlayer = game?.players?.find(p => p.id === game.currentPlayerId);
  const clockwiseOpponents = game ? getClockwiseOpponents(game.players, user.id) : [];
  const canStartGame = isHost && game?.players?.length >= 2;
  const isMobileLayout = initialLayout === 'mobile';
  const gameScale = Math.max(
    MIN_DESKTOP_SCALE,
    Math.min(
      1,
      viewport.width / DESKTOP_GAME_WIDTH,
      viewport.height / DESKTOP_GAME_HEIGHT
    )
  );

  if (!game) {
    return (
      <main className={`welcome ${isMobileLayout ? 'mobile-welcome' : ''}`}>
        <section className="welcome-card">
          <div className="brand">
            <div className="brand-mark">♠ ♥ ♦ ♣</div>
            <h1>Катарик</h1>
            <p>Онлайн-карточная игра для друзей</p>
          </div>

          <div className="lobby-form">
            <label>
              <span>Имя</span>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Твое имя"
              />
            </label>

            <div className="mode-grid" aria-label="Режим игры">
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

            <button className="primary" disabled={!connected} onClick={createRoom}>
              Создать комнату
            </button>

            <div className="join-row">
              <input
                value={joinCode}
                onChange={e => setJoinCode(e.target.value.toUpperCase())}
                placeholder="Код комнаты"
              />
              <button disabled={!connected} onClick={joinRoom}>Войти</button>
            </div>

            <div className={connected ? 'connection online' : 'connection'}>
              {connected ? 'Сервер подключен' : 'Подключение...'}
            </div>

            {error && <div className="toast error">{error}</div>}
          </div>
        </section>
      </main>
    );
  }

  return (
    <div
      className={`game-page ${isMobileLayout ? 'mobile-layout' : 'desktop-layout'}`}
      style={{ '--game-scale': isMobileLayout ? 1 : gameScale }}
    >
      <div className="game-frame">
        <main className="game-screen game-scale">
      <header className="topbar">
        <div className="room-chip">
          <span>Комната</span>
          <b>{game.roomId}</b>
        </div>

        <div className={`top-actions ${game.status === 'lobby' ? 'lobby-actions' : ''}`}>
          <div className="side-room-info">
            <span>Комната</span>
            <b>{game.roomId}</b>
          </div>
          <span className="mode-chip">{modeName(game.mode)}</span>
          <button className="ghost-button" onClick={copyInvite}>
            {inviteCopied ? 'Скопировано' : 'Пригласить'}
          </button>
          <button className="ghost-button leave-button" onClick={leaveRoom}>
            Выйти
          </button>
          {isHost && game.status === 'round_finished' && (
            <button className="solid-button" onClick={() => send('nextRound')}>Следующий кон</button>
          )}
          {isHost && game.status === 'finished' && (
            <button className="solid-button" onClick={() => send('restartGame')}>Играть заново</button>
          )}
          {!isHost && ['lobby', 'round_finished', 'finished'].includes(game.status) && (
            <span className="host-wait">Ждем хозяина</span>
          )}
        </div>
      </header>

      {game.status === 'lobby' && (
        <aside className="waiting-sidebar">
          <div className="waiting-sidebar-title">
            <span>Игроки</span>
            <b>{game.players.length}/11</b>
          </div>

          <div className="waiting-list">
            {game.players.map(player => (
              <div
                className={`waiting-player ${player.id === user.id ? 'me' : ''}`}
                key={player.id}
              >
                <div className="avatar">{player.name?.[0] || '?'}</div>
                <div>
                  <b>{player.name}</b>
                  <span>{player.id === game.hostPlayerId ? 'Хозяин комнаты' : 'Игрок'}</span>
                </div>
                {player.id === user.id && <em>Вы</em>}
              </div>
            ))}
          </div>
        </aside>
      )}

      {game.status === 'lobby' ? (
        <section className="waiting-room">
          <div className="waiting-panel">
            <div className="waiting-kicker">{modeName(game.mode)}</div>
            <h2>Комната готовится</h2>
            <p>
              Игроки заходят по ссылке приглашения. Начать игру сможет хозяин комнаты.
            </p>

            <div className="waiting-code">
              <span>Код комнаты</span>
              <b>{game.roomId}</b>
            </div>

            <div className="waiting-list">
              {game.players.map(player => (
                <div
                  className={`waiting-player ${player.id === user.id ? 'me' : ''}`}
                  key={player.id}
                >
                  <div className="avatar">{player.name?.[0] || '?'}</div>
                  <div>
                    <b>{player.name}</b>
                    <span>{player.id === game.hostPlayerId ? 'Хозяин комнаты' : 'Игрок'}</span>
                  </div>
                  {player.id === user.id && <em>Вы</em>}
                </div>
              ))}
            </div>

            <div className="waiting-actions">
              <button className="ghost-button" onClick={copyInvite}>
                {inviteCopied ? 'Ссылка скопирована' : 'Пригласить'}
              </button>
              {isHost ? (
                <button
                  className="solid-button"
                  disabled={!canStartGame}
                  onClick={() => send('startGame')}
                >
                  Начать игру
                </button>
              ) : (
                <span className="host-wait">Ждем хозяина</span>
              )}
            </div>

            {isHost && !canStartGame && (
              <div className="waiting-note">Нужен еще один игрок</div>
            )}
          </div>
        </section>
      ) : (
        <>
      <section className="table-shell">
        <div className={`opponents opponents-${clockwiseOpponents.length}`}>
          {clockwiseOpponents.map((p, index) => (
            <PlayerBadge
              key={p.id}
              player={p}
              game={game}
              position={index}
            />
          ))}
        </div>

        <div className={isMyTurn ? 'turn-pill your-turn' : 'turn-pill'}>
          Ходит: <b>{currentPlayer?.name || '—'}</b>
        </div>

        <div className={`table-cards ${game.table?.cards?.length > 5 ? 'multi-row' : ''}`}>
          {game.table?.cards?.length ? (
            splitTableRows(game.table.cards).map((row, rowIndex) => (
              <div className="table-card-row" key={rowIndex}>
                {row.map((card, i) => (
                  <Card
                    key={card.id}
                    card={card}
                    table
                    tableCompact={game.table.cards.length > 5}
                    index={i}
                  />
                ))}
              </div>
            ))
          ) : (
            <div className="empty-table">Стол пустой</div>
          )}
        </div>

        {game.table?.combo && (
          <div className="combo-pill">{comboText(game.table.combo, game.table.cards)}</div>
        )}

        {game.status === 'finished' && (
          <div className="result-card">
            <h2>Игра окончена</h2>
            <p>{finishedGameText(game)}</p>
          </div>
        )}
      </section>
      <section className="my-zone">
        <div className="hand-fan">
          {splitHandRows(game.hand).map((row, rowIndex) => (
            <div className="hand-row" key={rowIndex}>
              {row.map((card, index) => (
                <Card
                  key={card.id}
                  card={card}
                  selected={selected.includes(card.id)}
                  onClick={() => toggle(card.id)}
                  index={index}
                  total={row.length}
                />
              ))}
            </div>
          ))}
        </div>
      </section>

      <div className="me-badge">
        <span>{me?.name || name}</span>
        <small>Количество карт: {me?.handCount ?? 0} карт</small>
        {game.mode === 'pogoni' && <small>Погон: {me?.pogonRank}</small>}
      </div>

        <div className="action-bar">
          <button className="play-button" disabled={!isMyTurn || selected.length === 0} onClick={play}>
            Походить{selected.length ? ` (${selected.length})` : ''}
          </button>
          <button className="pass-button" disabled={!isMyTurn || !game.table} onClick={() => send('pass')}>
            Пас
          </button>
        </div>

        <div className={isMyTurn ? 'hint your-turn' : 'hint'}>
          {isMyTurn ? 'Ваш ход' : 'Ждем ход другого игрока'}
        </div>
        </>
      )}

      {error && (
        <div className={`toast error floating ${game.status === 'finished' ? 'finished-toast' : ''}`}>
          {error}
        </div>
      )}
    </main>
      </div>
    </div>
  );
}

function PlayerBadge({ player, game, position }) {
  const isTurn = player.id === game.currentPlayerId;
  const eliminated = game.eliminatedIds?.includes(player.id);
  const count = player.handCount ?? 0;

  return (
    <div className={`seat seat-${position} ${isTurn ? 'turn' : ''} ${eliminated ? 'eliminated' : ''}`}>
      <div className="seat-info">
        <div className="avatar">{player.name?.[0] || '?'}</div>

        <div>
          <b>{player.name}</b>
          <span>{eliminated ? 'вылетел' : `${count} карт`}</span>
          {game.mode === 'pogoni' && <small>Погон: {player.pogonRank}</small>}
        </div>
      </div>
    </div>
  );
}

function getClockwiseOpponents(players = [], viewerId) {
  const viewerIndex = players.findIndex(p => p.id === viewerId);

  if (viewerIndex < 0) {
    return players.filter(p => p.id !== viewerId);
  }

  return players
    .slice(viewerIndex + 1)
    .concat(players.slice(0, viewerIndex));
}

function splitHandRows(cards = []) {
  if (cards.length <= 10) {
    return [cards];
  }

  const firstRowCount = Math.ceil(cards.length / 2);

  return [
    cards.slice(0, firstRowCount),
    cards.slice(firstRowCount),
  ];
}

function splitTableRows(cards = []) {
  if (cards.length <= 5) {
    return [cards];
  }

  const firstRowCount = Math.ceil(cards.length / 2);

  return [
    cards.slice(0, firstRowCount),
    cards.slice(firstRowCount),
  ];
}

function Card({ card, selected, onClick, table, tableCompact, index = 0, total = 1 }) {
  const red = card.suit === 'H' || card.suit === 'D' || card.rank === 'RED_JOKER';
  const label = cardLabel(card);

  const style = {
    '--card-transform': table
      ? 'rotate(0deg)'
      : `translateX(${(index - (total - 1) / 2) * -7}px) rotate(0deg)`,
  };

  return (
    <button
      className={`playing-card ${red ? 'red' : ''} ${selected ? 'selected' : ''} ${table ? 'table-card' : ''} ${tableCompact ? 'compact' : ''}`}
      onClick={onClick}
      style={style}
      aria-label={label}
    >
      <img
        src={`/cards/${cardImage(card)}`}
        alt={label}
        className="card-image"
      />
    </button>
  );
}

function cardLabel(card) {
  if (card.rank === 'BLACK_JOKER') return 'Joker ♠';
  if (card.rank === 'RED_JOKER') return 'Joker ♥';
  if (card.rank === 'DVK') return 'DVK';

  return `${card.rank}${suit(card.suit)}`;
}

function cardImage(card) {
  if (card.rank === 'BLACK_JOKER') return 'BLACK_JOKER.png';
  if (card.rank === 'RED_JOKER') return 'RED_JOKER.png';
  if (card.rank === 'DVK') return 'DVK.png';

  return `${card.rank}${card.suit}.png`;
}

function suit(s) {
  return { S: '♠', H: '♥', D: '♦', C: '♣' }[s] || '';
}

function comboText(c, cards = []) {
  if (!c) return '';

  const map = {
    single: 'одна карта',
    pair: 'двойник',
    triple: 'три одинаковых',
    quad: 'четыре одинаковых',
    straight: 'катарик',
    doubleStraight: 'бомба',
  };

  const name = map[c.type] || c.type;
  const detail = comboDetail(c, cards);

  return detail ? `${name}: ${detail}` : name;
}

function comboDetail(c, cards) {
  if (c.type === 'single') {
    return cardRankText(cards[0]) || rankFromValue(c.high);
  }

  if (['pair', 'triple', 'quad'].includes(c.type)) {
    return rankFromValue(c.high);
  }

  if (['straight', 'doubleStraight'].includes(c.type)) {
    const from = rankFromValue(c.high - c.length + 1);
    const to = rankFromValue(c.high);
    return from && to ? `от ${from} до ${to}` : '';
  }

  return '';
}

function cardRankText(card) {
  if (!card) return '';
  if (card.rank === 'BLACK_JOKER') return 'черный джокер';
  if (card.rank === 'RED_JOKER') return 'красный джокер';
  if (card.rank === 'DVK') return 'ДВК';
  return card.rank;
}

function rankFromValue(value) {
  const ranks = {
    1: '4',
    2: '5',
    3: '6',
    4: '7',
    5: '8',
    6: '9',
    7: '10',
    8: 'J',
    9: 'Q',
    10: 'K',
    11: 'A',
    12: '2',
    13: '3',
    14: 'черный джокер',
    15: 'красный джокер',
  };

  return ranks[value] || '';
}

function finishedGameText(game) {
  const winnerName = game.players.find(player => player.id === game.roundWinnerId)?.name;
  const loserName = game.players.find(player => player.id === game.loserId)?.name;

  if (game.mode === 'pogoni') {
    return `Победил: ${winnerName || '—'}`;
  }

  return `Проиграл: ${loserName || '—'}`;
}

function modeName(mode) {
  if (mode === 'elimination') return 'На вылет';
  if (mode === 'pogoni') return 'Погоны';
  return 'Обычный';
}

createRoot(document.getElementById('root')).render(<App />);
