import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { App } from "./App.jsx";

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

class TestAudioContext {
  static starts = [];

  constructor() {
    this.currentTime = 0;
    this.destination = {};
    this.state = "running";
  }

  createOscillator() {
    return {
      connect() {},
      frequency: { setValueAtTime() {} },
      start: () => TestAudioContext.starts.push(true),
      stop() {},
      type: "sine",
    };
  }

  createGain() {
    return {
      connect() {},
      gain: {
        exponentialRampToValueAtTime() {},
        setValueAtTime() {},
      },
    };
  }

  resume() {
    return Promise.resolve();
  }
}

class TestAudio {
  play() {
    return Promise.resolve();
  }
}

function card(id, rank, suit = "S") {
  return { id, rank, suit, type: "normal" };
}

function playingGame(overrides = {}) {
  return {
    roomId: "ABC123",
    mode: "classic",
    status: "playing",
    roundNumber: 1,
    hostPlayerId: "player-1",
    currentPlayerId: "player-1",
    table: null,
    hand: [card("5S", "5"), card("8H", "8", "H")],
    players: [
      { id: "player-1", name: "Асет", active: true, handCount: 2 },
      { id: "player-2", name: "Бот", active: true, handCount: 6 },
    ],
    ...overrides,
  };
}

test("welcome screen links to privacy policy and terms", () => {
  render(<App />);

  expect(
    screen.getByRole("link", { name: "Политика конфиденциальности" }),
  ).toHaveAttribute("href", "/privacy.html");
  expect(
    screen.getByRole("link", { name: "Условия использования" }),
  ).toHaveAttribute("href", "/terms.html");
});

async function renderConnectedGame(game = playingGame()) {
  render(<App />);
  const socket = TestWebSocket.instances.at(-1);
  await act(async () => socket.open());
  await act(async () => socket.message({ type: "state", game }));
  return socket;
}

beforeEach(() => {
  TestWebSocket.instances = [];
  TestAudioContext.starts = [];
  globalThis.WebSocket = TestWebSocket;
  globalThis.AudioContext = TestAudioContext;
  globalThis.Audio = TestAudio;
  sessionStorage.setItem("katarik_user_id", "player-1");
  sessionStorage.setItem("katarik_session_token", "test-token");
  localStorage.setItem("katarik_name", "Асет");
  vi.spyOn(window.history, "replaceState").mockImplementation(() => {});
});

describe("active game interface", () => {
  test("plays an alarm only after the own turn lasts 30 seconds", async () => {
    vi.useFakeTimers();

    try {
      await renderConnectedGame();

      await act(async () => {
        vi.advanceTimersByTime(29_999);
        await Promise.resolve();
      });
      expect(TestAudioContext.starts).toHaveLength(0);

      await act(async () => {
        vi.advanceTimersByTime(1);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(TestAudioContext.starts).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  test("selects and deselects a card and sends the selected card", async () => {
    const user = userEvent.setup();
    const socket = await renderConnectedGame();
    const cardButton = screen.getByRole("button", { name: "5♠" });
    const playButton = screen.getByRole("button", { name: "Походить" });

    expect(playButton).toBeDisabled();
    await user.click(cardButton);
    expect(cardButton).toHaveClass("selected");
    expect(screen.getByRole("button", { name: "Походить (1)" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Походить (1)" }));
    expect(socket.sent.at(-1)).toMatchObject({
      type: "play",
      playerId: "player-1",
      cardIds: ["5S"],
    });
    expect(screen.getByRole("button", { name: "Походить" })).toBeDisabled();

    await user.click(cardButton);
    await user.click(cardButton);
    expect(cardButton).not.toHaveClass("selected");
  });

  test("shows who played and whose turn it is and enables pass only on an active table", async () => {
    await renderConnectedGame(
      playingGame({
        table: {
          playerId: "player-2",
          cards: [card("7D", "7", "D")],
          combo: { type: "single", high: 4, length: 1 },
        },
      }),
    );

    expect(screen.getByText(/Ходил:/)).toHaveTextContent(
      "Ходил: Бот. Ходит: Асет",
    );
    expect(screen.getByRole("button", { name: "Пас" })).toBeEnabled();
    expect(screen.getByText("Ваш ход")).toBeInTheDocument();
  });

  test("keeps play and pass disabled while another player is moving", async () => {
    const user = userEvent.setup();
    await renderConnectedGame(
      playingGame({
        currentPlayerId: "player-2",
        table: {
          playerId: "player-2",
          cards: [card("7D", "7", "D")],
          combo: { type: "single", high: 4, length: 1 },
        },
      }),
    );

    await user.click(screen.getByRole("button", { name: "5♠" }));
    expect(screen.getByRole("button", { name: "Походить (1)" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Пас" })).toBeDisabled();
    expect(screen.getByText("Ждем ход другого игрока")).toBeInTheDocument();
  });

  test("keeps selected cards when another player updates the game state", async () => {
    const user = userEvent.setup();
    const socket = await renderConnectedGame(
      playingGame({
        currentPlayerId: "player-2",
      }),
    );
    const selectedCard = screen.getByRole("button", { name: /5/ });

    await user.click(selectedCard);
    expect(selectedCard).toHaveClass("selected");

    await act(async () =>
      socket.message({
        type: "state",
        game: playingGame({
          currentPlayerId: "player-1",
          table: {
            playerId: "player-2",
            cards: [card("9D", "9", "D")],
            combo: { type: "single", high: 6, length: 1 },
          },
        }),
      }),
    );

    expect(screen.getByRole("button", { name: /5/ })).toHaveClass("selected");
  });

  test("removes selected cards that are no longer in the hand", async () => {
    const user = userEvent.setup();
    const socket = await renderConnectedGame();

    await user.click(screen.getByRole("button", { name: /5/ }));
    await act(async () =>
      socket.message({
        type: "state",
        game: playingGame({
          hand: [card("8H", "8", "H")],
        }),
      }),
    );

    expect(screen.queryByRole("button", { name: /5/ })).not.toBeInTheDocument();
  });

  test("keeps a dragged hand order during a round and resets it for a new round", async () => {
    const user = userEvent.setup();
    const socket = await renderConnectedGame();
    const five = screen.getByRole("button", { name: /5/ });
    const eight = screen.getByRole("button", { name: /8/ });
    await user.click(five);
    await user.click(eight);
    expect(five).toHaveClass("selected");
    expect(eight).toHaveClass("selected");

    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function () {
        if (this.matches("[data-hand-row]")) {
          return {
            left: 0,
            right: 200,
            top: 176,
            bottom: 312,
            width: 200,
            height: 136,
          };
        }
        if (this.dataset?.handCardId === "5S") {
          return {
            left: 0,
            right: 92,
            top: 100,
            bottom: 236,
            width: 92,
            height: 136,
          };
        }
        if (this.dataset?.handCardId === "8H") {
          return {
            left: 50,
            right: 142,
            top: 176,
            bottom: 312,
            width: 92,
            height: 136,
          };
        }
        return { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 };
      },
    );

    fireEvent(
      five,
      new MouseEvent("pointerdown", {
        bubbles: true,
        button: 0,
        clientX: 10,
        clientY: 168,
      }),
    );
    fireEvent(
      window,
      new MouseEvent("pointermove", {
        bubbles: true,
        clientX: 120,
        clientY: 10,
      }),
    );

    expect(
      document.querySelector(".hand-fan .card-placeholder"),
    ).toBeInTheDocument();
    expect(document.querySelector(".hand-row")?.children[0]).toHaveClass(
      "card-placeholder",
    );
    expect(
      [...document.querySelectorAll(".hand-fan .playing-card")]
        .map((element) => element.getAttribute("aria-label"))
        .filter(Boolean),
    ).toEqual(["8♥"]);
    expect(
      document.querySelector(".card-drag-preview .playing-card"),
    ).toHaveClass("dragging");
    expect(screen.getByRole("button", { name: /8/ })).not.toHaveClass(
      "selected",
    );
    expect(screen.getByRole("button", { name: /8/ })).not.toHaveClass(
      "drag-neighbor",
    );

    fireEvent(
      window,
      new MouseEvent("pointermove", {
        bubbles: true,
        clientX: 120,
        clientY: 109,
      }),
    );

    expect(
      document.querySelector(".hand-fan .card-placeholder"),
    ).toBeInTheDocument();
    expect(document.querySelector(".hand-row")?.children[1]).toHaveClass(
      "card-placeholder",
    );
    expect(screen.getByRole("button", { name: /8/ })).toHaveClass(
      "drag-neighbor",
    );

    fireEvent(
      window,
      new MouseEvent("pointermove", {
        bubbles: true,
        clientX: 120,
        clientY: 200,
      }),
    );

    expect(document.querySelector(".hand-row")?.children[1]).toHaveClass(
      "card-placeholder",
    );
    expect(screen.getByRole("button", { name: /8/ })).toHaveClass(
      "drag-neighbor",
    );

    fireEvent(
      window,
      new MouseEvent("pointerup", {
        bubbles: true,
        clientX: 120,
        clientY: 200,
      }),
    );
    expect(screen.getByRole("button", { name: /5/ })).not.toHaveClass(
      "dragging",
    );
    expect(screen.getByRole("button", { name: /8/ })).not.toHaveClass(
      "drag-neighbor",
    );

    await act(async () =>
      socket.message({
        type: "state",
        game: playingGame(),
      }),
    );

    expect(
      [...document.querySelectorAll(".hand-fan .playing-card")].map((element) =>
        element.getAttribute("aria-label"),
      ),
    ).toEqual(["8♥", "5♠"]);

    await act(async () =>
      socket.message({
        type: "state",
        game: playingGame({ roundNumber: 2 }),
      }),
    );

    expect(
      [...document.querySelectorAll(".hand-fan .playing-card")].map((element) =>
        element.getAttribute("aria-label"),
      ),
    ).toEqual(["5♠", "8♥"]);
  });

  test("shows a server game error on the table", async () => {
    const socket = await renderConnectedGame();

    await act(async () =>
      socket.message({
        type: "error",
        message: "Эта комбинация не бьет предыдущую.",
      }),
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "Эта комбинация не бьет предыдущую.",
    );
  });
});
