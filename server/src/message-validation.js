const MESSAGE_TYPES = new Set([
  'ping',
  'createRoom',
  'joinRoom',
  'addBot',
  'leaveRoom',
  'kickPlayer',
  'startGame',
  'restartGame',
  'nextRound',
  'play',
  'pass',
]);

const GAME_MODES = new Set(['classic', 'elimination', 'pogoni']);
const DECLARED_RANKS = new Set(['4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2', '3']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireText(value, label, maxLength) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} должен быть непустой строкой`);
  }
  if (value.length > maxLength) throw new Error(`${label} слишком длинный`);
}

function validateIdentity(message) {
  requireText(message.playerId, 'Идентификатор игрока', 128);
  requireText(message.sessionToken, 'Ключ восстановления сессии', 256);

  if (message.name !== undefined && typeof message.name !== 'string') {
    throw new Error('Имя игрока должно быть строкой');
  }
  if (message.name?.length > 32) throw new Error('Имя игрока слишком длинное');
}

function validatePlay(message) {
  if (!Array.isArray(message.cardIds) || message.cardIds.length === 0) {
    throw new Error('Для хода нужен непустой список карт');
  }
  if (message.cardIds.length > 55) throw new Error('В одном ходе слишком много карт');

  const cardIds = new Set();
  for (const cardId of message.cardIds) {
    requireText(cardId, 'Идентификатор карты', 32);
    if (cardIds.has(cardId)) throw new Error('Список карт содержит повторения');
    cardIds.add(cardId);
  }

  if (message.declaredRanks === undefined) return;
  if (!isPlainObject(message.declaredRanks)) {
    throw new Error('Объявленные значения карт должны быть объектом');
  }

  for (const [cardId, rank] of Object.entries(message.declaredRanks)) {
    requireText(cardId, 'Идентификатор объявленной карты', 32);
    if (!DECLARED_RANKS.has(rank)) throw new Error('Объявлено недопустимое значение карты');
  }
}

export function validateClientMessage(message) {
  if (!isPlainObject(message)) throw new Error('Сообщение должно быть объектом');
  if (typeof message.type !== 'string' || !MESSAGE_TYPES.has(message.type)) {
    throw new Error('Неизвестный тип сообщения');
  }

  if (message.type === 'createRoom') {
    validateIdentity(message);
    if (!GAME_MODES.has(message.mode)) throw new Error('Неизвестный режим игры');
  }

  if (message.type === 'joinRoom') {
    validateIdentity(message);
    requireText(message.roomId, 'Код комнаты', 6);
    if (!/^[A-Za-z0-9]{6}$/.test(message.roomId)) throw new Error('Некорректный код комнаты');
  }

  if (message.type === 'kickPlayer') {
    requireText(message.targetPlayerId, 'Идентификатор удаляемого игрока', 128);
  }

  if (message.type === 'play') validatePlay(message);

  return message;
}

export function parseClientMessage(raw) {
  let message;
  try {
    message = JSON.parse(raw.toString());
  } catch {
    throw new Error('Сообщение содержит некорректный JSON');
  }

  return validateClientMessage(message);
}
