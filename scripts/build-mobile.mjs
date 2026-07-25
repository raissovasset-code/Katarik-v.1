import { spawnSync } from "node:child_process";

const result = spawnSync("npm", ["run", "build", "--prefix", "client"], {
  env: {
    ...process.env,
    VITE_WS_URL: "wss://katarik-5g25.onrender.com",
  },
  shell: process.platform === "win32",
  stdio: "inherit",
});

process.exit(result.status ?? 1);
