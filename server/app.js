import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { MAX_AUDIO_BYTES, checkAudio } from "../public/limits.js";
import { newToken } from "./token.js";

const PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));
const HTML = "text/html; charset=utf-8";
const JS = "text/javascript; charset=utf-8";

// The only files the server will ever send from public/.
const STATIC = {
  "/": ["index.html", HTML],
  "/index.html": ["index.html", HTML],
  "/style.css": ["style.css", "text/css; charset=utf-8"],
  "/app.js": ["app.js", JS],
  "/create-logic.js": ["create-logic.js", JS],
  "/limits.js": ["limits.js", JS],
  "/wav.js": ["wav.js", JS],
};

const SAFE = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SAFE, "Content-Length": Buffer.byteLength(body), ...headers });
  res.end(body);
}

const sendJson = (res, status, body, headers) =>
  send(res, status, JSON.stringify(body), { "Content-Type": "application/json", ...headers });

const page = (res, text, status) =>
  send(
    res,
    status,
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font:18px system-ui;text-align:center;padding:4rem">${text}`,
    { "Content-Type": HTML },
  );

// Answer without reading the rest of the request, then close the connection.
function refuse(req, res, status, error) {
  sendJson(res, status, { error }, { Connection: "close" });
  req.resume();
}

// Reads the body but never keeps more than the audio limit. Anything past the
// limit is read and thrown away (up to a cap), so the client finishes sending
// and can see our 413 instead of a reset connection. Does not use
// `for await ... return`, which would destroy the socket before we can answer.
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let over = Number(req.headers["content-length"] ?? 0) > MAX_AUDIO_BYTES;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_AUDIO_BYTES * 3) return req.destroy();
      if (over) return;
      if (size > MAX_AUDIO_BYTES) {
        over = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(over ? null : Buffer.concat(chunks)));
    req.on("close", () => resolve(null));
    req.on("error", reject);
  });
}

async function create(req, res, { store, limiter, getPublicBase }) {
  const client = req.headers["cf-connecting-ip"] ?? req.socket.remoteAddress ?? "unknown";
  if (!limiter.hit(client).allowed) return refuse(req, res, 429, "Too many links. Try again later.");
  if (store.isFull()) return refuse(req, res, 503, "The server is busy. Try again later.");

  const bytes = await readBody(req);
  if (!bytes) return refuse(req, res, 413, "That file is too big (max 3 MB).");

  const check = checkAudio({ size: bytes.length, type: req.headers["content-type"] });
  if (!check.ok) return sendJson(res, check.status, { error: check.error });

  const token = newToken();
  if (!store.add(token, bytes, check.type)) return sendJson(res, 503, { error: "The server is busy. Try again later." });

  const proto = String(req.headers["x-forwarded-proto"] ?? "http").split(",")[0].trim();
  const base = getPublicBase() ?? `${proto}://${req.headers.host}`;
  return sendJson(res, 201, { link: `${base}/${token}` });
}

async function serveStatic(req, res, [file, type]) {
  if (req.method !== "GET" && req.method !== "HEAD") return sendJson(res, 405, { error: "Method not allowed." });
  return send(res, 200, await readFile(PUBLIC_DIR + file), { "Content-Type": type });
}

export function createApp({ store, limiter, getPublicBase = () => null }) {
  return async function handle(req, res) {
    try {
      const pathname = req.url.split("?")[0];
      if (pathname === "/api/create") {
        if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
        return await create(req, res, { store, limiter, getPublicBase });
      }
      if (Object.hasOwn(STATIC, pathname)) return await serveStatic(req, res, STATIC[pathname]);
      return page(res, "This link is not available.", 404);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) sendJson(res, 500, { error: "Something went wrong." });
      else res.end();
    }
  };
}
