import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const TUNNEL_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;
const HOMEBREW_BIN = "/opt/homebrew/opt/cloudflared/bin/cloudflared";

export const parseTunnelUrl = (text) => text.match(TUNNEL_URL)?.[0] ?? null;

export function findCloudflared(env = process.env, exists = existsSync) {
  if (env.CLOUDFLARED_BIN) return env.CLOUDFLARED_BIN;
  return exists(HOMEBREW_BIN) ? HOMEBREW_BIN : "cloudflared";
}

export function startTunnel(port, { bin = findCloudflared(), args, timeoutMs = 30000 } = {}) {
  return new Promise((resolve) => {
    let child;
    let done = false;
    let seen = "";

    const finish = (url) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ url, stop: () => child?.kill() });
    };
    const timer = setTimeout(() => finish(null), timeoutMs);

    try {
      child = spawn(bin, args ?? ["tunnel", "--url", `http://127.0.0.1:${port}`, "--no-autoupdate"], {
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      return finish(null);
    }
    child.on("error", () => finish(null));
    child.on("exit", () => finish(null));

    const onData = (data) => {
      seen = (seen + data).slice(-2000);
      const url = parseTunnelUrl(seen);
      if (url) finish(url);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
  });
}
