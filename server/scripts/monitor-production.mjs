import WebSocket from "ws";

import { checkProduction } from "../src/production-monitor.js";

const baseUrl =
  process.env.PRODUCTION_URL || "https://katarik-5g25.onrender.com";
const result = await checkProduction({
  baseUrl,
  WebSocketImpl: WebSocket,
});

process.stdout.write(`${JSON.stringify(result)}\n`);
