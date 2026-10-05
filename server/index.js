import http from "node:http";
import { createApp } from "./app.js";
import { createStore } from "./store.js";
import { createLimiter } from "./ratelimit.js";
import { startTunnel } from "./tunnel.js";

export async function start({ port = 8787, tunnel = true, tunnelOptions = {}, log = console.log } = {}) {
  const store = createStore();
  const limiter = createLimiter();
  let publicUrl = null;

  const server = http.createServer(createApp({ store, limiter, getPublicBase: () => publicUrl }));
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const actualPort = server.address().port;

  const prune = setInterval(() => limiter.prune(), 10 * 60 * 1000);
  prune.unref();

  let tun = null;
  if (tunnel) {
    log("Starting the public tunnel...");
    tun = await startTunnel(actualPort, tunnelOptions);
    publicUrl = tun.url;
    log(publicUrl ? `Public address: ${publicUrl}` : "No public tunnel (cloudflared missing or too slow). Running local only.");
  }

  return {
    port: actualPort,
    localUrl: `http://localhost:${actualPort}`,
    get publicUrl() {
      return publicUrl;
    },
    store,
    limiter,
    async close() {
      clearInterval(prune);
      tun?.stop();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
