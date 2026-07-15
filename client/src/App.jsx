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
  const storage = isNativeApp() ? localStorage : sessionStorage;
  const savedId = storage.getItem('katarik_user_id');
  const savedToken = storage.getItem('katarik_session_token');
  const id = savedId || createId();
  const sessionToken = savedToken || createId();

  if (!savedId) {
    storage.setItem('katarik_user_id', id);
  }

  if (!savedToken) {
    storage.setItem('katarik_session_token', sessionToken);
  }

  return {
    id,
    sessionToken,
    name: localStorage.getItem('katarik_name') || 'Игрок',
  };
}

function isNativeApp() {
  return Boolean(window.Capacitor?.isNativePlatform?.());
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
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  const [inviteCopied, setInviteCopied] = useState(false);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const [viewport, setViewport] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  const wsRef = useRef(null);
  const nameRef = useRef(name);
  const reconnectTimerRef = useRef(null);
  const reconnectAttemptRef = useRef(0);
  const lastMessageAtRef = useRef(Date.now());

  useEffect(() => {
    localStorage.setItem('katarik_name', name);
    nameRef.current = name;
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
    let active = true;

    function identityPayload() {
      return {
        playerId: user.id,
        sessionToken: user.sessionToken,
        name: nameRef.current || user.name,
      };
    }

    function clearConnectionError() {
      setError(current => (
        current.startsWith('Соединение потеряно') || current === 'Нет соединения с сервером.'
          ? ''
          : current
      ));
    }

    function scheduleReconnect() {
      if (!active || reconnectTimerRef.current) return;

      const attempt = reconnectAttemptRef.current;
      const delay = Math.min(8000, 500 * (2 ** attempt));
      reconnectAttemptRef.current += 1;
      setConnectionStatus('reconnecting');

      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        connect();
      }, delay);
    }

    function connect() {
      if (!active) return;

      const currentSocket = wsRef.current;
      if (
        currentSocket?.readyState === WebSocket.OPEN ||
        currentSocket?.readyState === WebSocket.CONNECTING
      ) {
        return;
      }

      setConnectionStatus(reconnectAttemptRef.current ? 'reconnecting' : 'connecting');
      const socket = new WebSocket(WS_URL);
      let restoringRoom = false;
      wsRef.current = socket;

      socket.onopen = () => {
        if (!active || wsRef.current !== socket) return;

        setConnected(true);
        setConnectionStatus('connected');
        reconnectAttemptRef.current = 0;
        lastMessageAtRef.current = Date.now();
        clearConnectionError();

        const savedRoomId = localStorage.getItem('katarik_room');
        if (savedRoomId) {
          restoringRoom = true;
          socket.send(JSON.stringify({
            type: 'joinRoom',
            roomId: savedRoomId,
            ...identityPayload(),
          }));
        }
      };

      socket.onmessage = event => {
        if (!active || wsRef.current !== socket) return;
        lastMessageAtRef.current = Date.now();

        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          setError('Сервер прислал некорректный ответ.');
          return;
        }

        if (msg.type === 'pong') return;

        if (msg.type === 'roomCreated') {
          restoringRoom = false;
          setJoinCode(msg.roomId);
          localStorage.setItem('katarik_room', msg.roomId);
          window.history.replaceState(null, '', roomPath(msg.roomId));
        }

        if (msg.type === 'state') {
          restoringRoom = false;
          clearConnectionError();
          setGame(msg.game);
          setSelected([]);
        }

        if (msg.type === 'leftRoom') {
          restoringRoom = false;
          setGame(null);
          setSelected([]);
          setJoinCode('');
          localStorage.removeItem('katarik_room');
          window.history.replaceState(null, '', window.location.pathname);
        }

        if (msg.type === 'error') {
          if (
            restoringRoom &&
            ['Комната не найдена', 'Это место игрока принадлежит другому устройству'].includes(msg.message)
          ) {
            restoringRoom = false;
            localStorage.removeItem('katarik_room');
            setGame(null);
          }

          setError(msg.message);
        }
      };

      socket.onerror = () => {
        if (wsRef.current === socket) socket.close();
      };

      socket.onclose = () => {
        if (!active || wsRef.current !== socket) return;

        setConnected(false);
        setConnectionStatus('reconnecting');
        setError('Соединение потеряно. Переподключаемся…');
        scheduleReconnect();
      };
    }

    function checkConnection() {
      const socket = wsRef.current;

      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'ping' }));
      } else {
        connect();
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') checkConnection();
    }

    connect();

    const heartbeatTimer = window.setInterval(() => {
      const socket = wsRef.current;
      if (socket?.readyState !== WebSocket.OPEN) return;

      if (Date.now() - lastMessageAtRef.current > 30000) {
        socket.close();
        return;
      }

      socket.send(JSON.stringify({ type: 'ping' }));
    }, 10000);

    window.addEventListener('online', checkConnection);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      active = false;
      window.clearInterval(heartbeatTimer);
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
      window.removeEventListener('online', checkConnection);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      wsRef.current?.close();
    };
  }, [user]);

  function send(type, payload = {}) {
    setError('');

    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      setError('Нет соединения с сервером.');
      return;
    }

    wsRef.current.send(JSON.stringify({
      type,
      playerId: user.id,
      sessionToken: user.sessionToken,
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
    if (game?.status === 'playing' || game?.status === 'round_finished') {
      setLeaveConfirmOpen(true);
      return;
    }

    confirmLeaveRoom();
  }

  function confirmLeaveRoom() {
    setLeaveConfirmOpen(false);
    send('leaveRoom');
  }

  const me = game?.players?.find(p => p.id === user.id);
  const isMyTurn = game?.currentPlayerId === user.id;
  const isHost = game?.hostPlayerId === user.id;
  const currentPlayer = game?.players?.find(p => p.id === game.currentPlayerId);
  const clockwiseOpponents = game ? getClockwiseOpponents(game.players, user.id) : [];
  const canStartGame = isHost && game?.players?.length >= 2;
  const remainingPlayerCount = game?.players?.filter(player => !player.leaving).length || 0;
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
              {connectionStatus === 'connected'
                ? 'Сервер подключен'
                : connectionStatus === 'reconnecting'
                  ? 'Переподключение...'
                  : 'Подключение...'}
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
            <button className="solid-button" disabled={!connected || remainingPlayerCount < 2} onClick={() => send('nextRound')}>
              Следующий кон
            </button>
          )}
          {isHost && game.status === 'finished' && (
            <button className="solid-button" disabled={!connected || remainingPlayerCount < 2} onClick={() => send('restartGame')}>
              Играть заново
            </button>
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
                  disabled={!connected || !canStartGame}
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
          <button
            className="play-button"
            disabled={!connected || !isMyTurn || selected.length === 0}
            onClick={play}
          >
            Походить{selected.length ? ` (${selected.length})` : ''}
          </button>
          <button
            className="pass-button"
            disabled={!connected || !isMyTurn || !game.table}
            onClick={() => send('pass')}
          >
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

      {leaveConfirmOpen && (
        <div className="leave-confirm-backdrop" role="presentation" onClick={() => setLeaveConfirmOpen(false)}>
          <section
            className="leave-confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="leave-confirm-title"
            onClick={event => event.stopPropagation()}
          >
            <h2 id="leave-confirm-title">Выйти из игры?</h2>
            <p>
              Вы покинете активную игру и больше не сможете вернуться в эту комнату.
            </p>
            <div className="leave-confirm-actions">
              <button type="button" className="ghost-button" onClick={() => setLeaveConfirmOpen(false)}>
                Остаться
              </button>
              <button type="button" className="leave-confirm-button" onClick={confirmLeaveRoom}>
                Выйти из игры
              </button>
            </div>
          </section>
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
  const leaving = player.leaving;
  const count = player.handCount ?? 0;

  return (
    <div className={`seat seat-${position} ${isTurn ? 'turn' : ''} ${eliminated ? 'eliminated' : ''} ${leaving ? 'leaving' : ''}`}>
      <div className="seat-info">
        <div className="avatar">{player.name?.[0] || '?'}</div>

        <div>
          <b>{player.name}</b>
          <span>{leaving ? 'вышел' : eliminated ? 'вылетел' : `${count} карт`}</span>
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
  const rows = [];

  for (let i = 0; i < cards.length; i += 5) {
    rows.push(cards.slice(i, i + 5));
  }

  return rows.length ? rows : [[]];
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

  if (game.mode === 'pogoni' || !loserName) {
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
