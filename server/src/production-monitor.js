export async function checkProduction({
  baseUrl,
  timeoutMs = 70_000,
  fetchImpl = fetch,
  WebSocketImpl,
}) {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
  const readinessUrl = `${normalizedBaseUrl}/api/ready`;
  const websocketUrl = normalizedBaseUrl.replace(/^http/, "ws");
  const response = await fetchImpl(readinessUrl, {
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`Readiness returned HTTP ${response.status}`);
  }

  const readiness = await response.json();
  if (
    readiness.status !== "ready" ||
    readiness.checks?.roomStorage !== true ||
    readiness.checks?.websocket !== true
  ) {
    throw new Error("Readiness checks are not ready");
  }

  await checkWebSocket({
    url: websocketUrl,
    timeoutMs: Math.min(timeoutMs, 15_000),
    WebSocketImpl,
  });

  return {
    status: "ready",
    readinessUrl,
    websocketUrl,
  };
}

function checkWebSocket({ url, timeoutMs, WebSocketImpl }) {
  if (!WebSocketImpl) {
    throw new Error("WebSocket implementation is required");
  }

  return new Promise((resolve, reject) => {
    const socket = new WebSocketImpl(url);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("WebSocket heartbeat timed out"));
    }, timeoutMs);

    function finish(error) {
      clearTimeout(timeout);
      socket.close();
      if (error) reject(error);
      else resolve();
    }

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ type: "ping" }));
    });
    socket.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(event.data.toString());
        if (message.type === "pong") finish();
      } catch {
        finish(new Error("WebSocket returned invalid JSON"));
      }
    });
    socket.addEventListener("error", () => {
      finish(new Error("WebSocket connection failed"));
    });
  });
}
