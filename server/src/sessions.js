const MAX_PLAYER_ID_LENGTH = 128;
const MAX_SESSION_TOKEN_LENGTH = 256;
const MAX_PLAYER_NAME_LENGTH = 32;

function requiredText(value, label, maxLength) {
  const text = String(value || '').trim();

  if (!text) throw new Error(`${label} не указан`);
  if (text.length > maxLength) throw new Error(`${label} слишком длинный`);

  return text;
}

export function createPlayerFromMessage(message) {
  return {
    id: requiredText(message.playerId, 'Идентификатор игрока', MAX_PLAYER_ID_LENGTH),
    reconnectToken: requiredText(
      message.sessionToken,
      'Ключ восстановления сессии',
      MAX_SESSION_TOKEN_LENGTH
    ),
    name: String(message.name || 'Игрок').trim().slice(0, MAX_PLAYER_NAME_LENGTH) || 'Игрок',
  };
}

export function claimExistingPlayerSession(player, message) {
  const playerId = requiredText(message.playerId, 'Идентификатор игрока', MAX_PLAYER_ID_LENGTH);
  const reconnectToken = requiredText(
    message.sessionToken,
    'Ключ восстановления сессии',
    MAX_SESSION_TOKEN_LENGTH
  );

  if (player.id !== playerId) throw new Error('Сессия игрока не совпадает');

  if (!player.reconnectToken || player.reconnectToken !== reconnectToken) {
    throw new Error('Это место игрока принадлежит другому устройству');
  }

  return player;
}
