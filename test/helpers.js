import http from "node:http";
import { createApp } from "../server/app.js";
import { createStore } from "../server/store.js";
import { createLimiter } from "../server/ratelimit.js";

export async function startTestServer({ storeOptions, limiterOptions, getPublicBase, tts } = {}) {
  const store = createStore(storeOptions);
  const limiter = createLimiter(limiterOptions);
  const server = http.createServer(createApp({ store, limiter, getPublicBase, tts }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    store,
    limiter,
    close() {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

let n = 0;
export const nextIp = () => `10.2.0.${++n}`;

export function create(base, { bytes = new Uint8Array([1, 2, 3]), type = "audio/wav", ip = nextIp() } = {}) {
  const headers = { "cf-connecting-ip": ip };
  if (type) headers["content-type"] = type;
  return fetch(base + "/api/create", { method: "POST", headers, body: bytes });
}

export async function newLink(base, opts) {
  const res = await create(base, opts);
  if (res.status !== 201) throw new Error("create failed: " + res.status);
  return (await res.json()).link;
}

// Low-level request: keeps paths exactly as written and can send chunked bodies.
export function rawRequest(base, { method = "GET", path = "/", headers = {}, chunks = [] } = {}) {
  const { hostname, port } = new URL(base);
  return new Promise((resolve, reject) => {
    let status;
    let resHeaders;
    const parts = [];
    const done = () => resolve({ status, headers: resHeaders, body: Buffer.concat(parts) });
    const req = http.request({ hostname, port, method, path, headers }, (res) => {
      status = res.statusCode;
      resHeaders = res.headers;
      res.on("data", (c) => parts.push(c));
      res.on("end", done);
    });
    req.on("error", (err) => (status ? done() : reject(err)));
    for (const chunk of chunks) req.write(chunk);
    req.end();
  });
}
