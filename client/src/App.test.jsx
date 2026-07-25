import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { App } from './App.jsx';

class TestWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;
  static instances = [];

  constructor() {
    this.readyState = TestWebSocket.CONNECTING;
    this.sent = [];
    TestWebSocket.instances.push(this);
  }

  open() {
    this.readyState = TestWebSocket.OPEN;
    this.onopen?.();
  }

  message(payload) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }

  send(payload) {
    this.sent.push(JSON.parse(payload));
  }

  close() {
    this.readyState = TestWebSocket.CLOSED;
  }
}

function card(id, rank, suit = 'S') {
  return { id, rank, suit, type: 'normal' };
}

function playingGame(overrides = {}) {
  return {
    roomId: 'ABC123',
    mode: 'classic',
    status: 'playing',
    hostPlayerId: 'player-1',
    currentPlayerId: 'player-1',
    table: null,
    hand: [card('5S', '5'), card('8H', '8', 'H')],
    players: [
      { id: 'player-1', name: 'Асет', active: true, handCount: 2 },
      { id: 'player-2', name: 'Бот', active: true, handCount: 6 },
    ],
    ...overrides,
  };
}

async function renderConnectedGame(game = playingGame()) {
  render(<App />);
  const socket = TestWebSocket.instances.at(-1);
  await act(async () => socket.open());
  await act(async () => socket.message({ type: 'state', game }));
  return socket;
}

beforeEach(() => {
  TestWebSocket.instances = [];
  globalThis.WebSocket = TestWebSocket;
  sessionStorage.setItem('katarik_user_id', 'player-1');
  sessionStorage.setItem('katarik_session_token', 'test-token');
  localStorage.setItem('katarik_name', 'Асет');
  vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});
});

describe('active game interface', () => {
  test('selects and deselects a card and sends the selected card', async () => {
    const user = userEvent.setup();
    const socket = await renderConnectedGame();
    const cardButton = screen.getByRole('button', { name: '5♠' });
    const playButton = screen.getByRole('button', { name: 'Походить' });

    expect(playButton).toBeDisabled();
    await user.click(cardButton);
    expect(cardButton).toHaveClass('selected');
    expect(screen.getByRole('button', { name: 'Походить (1)' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Походить (1)' }));
    expect(socket.sent.at(-1)).toMatchObject({
      type: 'play',
      playerId: 'player-1',
      cardIds: ['5S'],
    });
    expect(screen.getByRole('button', { name: 'Походить' })).toBeDisabled();

    await user.click(cardButton);
    await user.click(cardButton);
    expect(cardButton).not.toHaveClass('selected');
  });

  test('shows who played and whose turn it is and enables pass only on an active table', async () => {
    await renderConnectedGame(playingGame({
      table: {
        playerId: 'player-2',
        cards: [card('7D', '7', 'D')],
        combo: { type: 'single', high: 4, length: 1 },
      },
    }));

    expect(screen.getByText(/Ходил:/)).toHaveTextContent('Ходил: Бот. Ходит: Асет');
    expect(screen.getByRole('button', { name: 'Пас' })).toBeEnabled();
    expect(screen.getByText('Ваш ход')).toBeInTheDocument();
  });

  test('keeps play and pass disabled while another player is moving', async () => {
    const user = userEvent.setup();
    await renderConnectedGame(playingGame({
      currentPlayerId: 'player-2',
      table: {
        playerId: 'player-2',
        cards: [card('7D', '7', 'D')],
        combo: { type: 'single', high: 4, length: 1 },
      },
    }));

    await user.click(screen.getByRole('button', { name: '5♠' }));
    expect(screen.getByRole('button', { name: 'Походить (1)' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Пас' })).toBeDisabled();
    expect(screen.getByText('Ждем ход другого игрока')).toBeInTheDocument();
  });

  test('keeps selected cards when another player updates the game state', async () => {
    const user = userEvent.setup();
    const socket = await renderConnectedGame(playingGame({
      currentPlayerId: 'player-2',
    }));
    const selectedCard = screen.getByRole('button', { name: /5/ });

    await user.click(selectedCard);
    expect(selectedCard).toHaveClass('selected');

    await act(async () => socket.message({
      type: 'state',
      game: playingGame({
        currentPlayerId: 'player-1',
        table: {
          playerId: 'player-2',
          cards: [card('9D', '9', 'D')],
          combo: { type: 'single', high: 6, length: 1 },
        },
      }),
    }));

    expect(screen.getByRole('button', { name: /5/ })).toHaveClass('selected');
  });

  test('removes selected cards that are no longer in the hand', async () => {
    const user = userEvent.setup();
    const socket = await renderConnectedGame();

    await user.click(screen.getByRole('button', { name: /5/ }));
    await act(async () => socket.message({
      type: 'state',
      game: playingGame({
        hand: [card('8H', '8', 'H')],
      }),
    }));

    expect(screen.queryByRole('button', { name: /5/ })).not.toBeInTheDocument();
  });

  test('reorders hand cards by dragging and keeps the order after a state update', async () => {
    const socket = await renderConnectedGame();
    const five = screen.getByRole('button', { name: /5/ });
    const eight = screen.getByRole('button', { name: /8/ });
    const dataTransfer = {
      effectAllowed: '',
      dropEffect: '',
      setData: vi.fn(),
    };

    fireEvent.dragStart(five, { dataTransfer });
    fireEvent.dragEnter(eight, { dataTransfer });
    fireEvent.dragEnd(five, { dataTransfer });

    expect([...document.querySelectorAll('.hand-fan .playing-card')]
      .map(element => element.getAttribute('aria-label'))).toEqual(['8♥', '5♠']);

    await act(async () => socket.message({
      type: 'state',
      game: playingGame(),
    }));

    expect([...document.querySelectorAll('.hand-fan .playing-card')]
      .map(element => element.getAttribute('aria-label'))).toEqual(['8♥', '5♠']);
  });

  test('shows a server game error on the table', async () => {
    const socket = await renderConnectedGame();

    await act(async () => socket.message({
      type: 'error',
      message: 'Эта комбинация не бьет предыдущую.',
    }));

    expect(screen.getByRole('status')).toHaveTextContent('Эта комбинация не бьет предыдущую.');
  });
});
