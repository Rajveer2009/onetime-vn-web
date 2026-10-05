import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { MAX_AUDIO_BYTES, MAX_TEXT_CHARS, checkAudio } from "../public/limits.js";
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

// Reads the body but never keeps more than `max` bytes. Anything past the
// limit is read and thrown away (up to a cap), so the client finishes sending
// and can see our 413 instead of a reset connection. Does not use
// `for await ... return`, which would destroy the socket before we can answer.
function readBody(req, max) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let over = Number(req.headers["content-length"] ?? 0) > max;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > Math.max(max * 3, 1024 * 1024)) return req.destroy();
      if (over) return;
      if (size > max) {
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

const SPEAK_BODY_LIMIT = 16 * 1024;
const BUSY = "The server is busy. Try again later.";

const clientOf = (req) => req.headers["cf-connecting-ip"] ?? req.socket.remoteAddress ?? "unknown";

function linkFor(req, getPublicBase, token) {
  const proto = String(req.headers["x-forwarded-proto"] ?? "http").split(",")[0].trim();
  return `${getPublicBase() ?? `${proto}://${req.headers.host}`}/${token}`;
}

async function create(req, res, { store, limiter, getPublicBase }) {
  if (!limiter.hit(clientOf(req)).allowed) return refuse(req, res, 429, "Too many links. Try again later.");
  if (store.isFull()) return refuse(req, res, 503, BUSY);

  const bytes = await readBody(req, MAX_AUDIO_BYTES);
  if (!bytes) return refuse(req, res, 413, "That file is too big (max 3 MB).");

  const check = checkAudio({ size: bytes.length, type: req.headers["content-type"] });
  if (!check.ok) return sendJson(res, check.status, { error: check.error });

  const token = newToken();
  if (!store.add(token, bytes, check.type)) return sendJson(res, 503, { error: BUSY });
  return sendJson(res, 201, { link: linkFor(req, getPublicBase, token) });
}

// Text in, spoken on the server by a voice engine, stored like an upload.
async function speak(req, res, { store, limiter, tts, getPublicBase }) {
  if (!limiter.hit(clientOf(req)).allowed) return refuse(req, res, 429, "Too many links. Try again later.");
  if (store.isFull()) return refuse(req, res, 503, BUSY);

  const raw = await readBody(req, SPEAK_BODY_LIMIT);
  if (!raw) return refuse(req, res, 413, "That text is too long.");
  let body;
  try {
    body = JSON.parse(raw.toString("utf8"));
  } catch {
    return sendJson(res, 400, { error: "Send the text as JSON." });
  }

  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return sendJson(res, 400, { error: "Type some text first." });
  if (text.length > MAX_TEXT_CHARS) return sendJson(res, 400, { error: `Text is too long (max ${MAX_TEXT_CHARS} characters).` });
  if (!tts.isValid(body.engine, body.voice)) return sendJson(res, 400, { error: "That voice is not available on the server." });

  let wav;
  try {
    wav = await tts.speak({ engine: body.engine, voice: body.voice, text });
  } catch (err) {
    if (err.busy) return sendJson(res, 503, { error: "The voice engine is busy. Try again in a minute." });
    console.error(err);
    return sendJson(res, 502, { error: "The voice engine failed. Try again." });
  }

  const check = checkAudio({ size: wav.length, type: "audio/wav" });
  if (!check.ok) {
    return check.status === 413
      ? sendJson(res, 413, { error: "That text makes audio over 3 MB. Please use shorter text." })
      : sendJson(res, 502, { error: "The voice engine made no audio. Try again." });
  }

  const token = newToken();
  if (!store.add(token, wav, check.type)) return sendJson(res, 503, { error: BUSY });
  return sendJson(res, 201, { link: linkFor(req, getPublicBase, token) });
}

async function serveStatic(req, res, [file, type]) {
  if (req.method !== "GET" && req.method !== "HEAD") return sendJson(res, 405, { error: "Method not allowed." });
  return send(res, 200, await readFile(PUBLIC_DIR + file), { "Content-Type": type });
}

async function player(req, res, store, token, isPlay) {
  if (!isPlay) {
    if (req.method !== "GET" && req.method !== "HEAD") return sendJson(res, 405, { error: "Method not allowed." });
    const status = store.status(token);
    if (status === "played") return page(res, "This voice note has already been played.", 410);
    if (status !== "unplayed") return page(res, "This link is not available.", 404);
    return send(res, 200, await readFile(PUBLIC_DIR + "play.html"), { "Content-Type": HTML });
  }

  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
  const claim = store.claim(token);
  if (!claim.ok) {
    return claim.reason === "played"
      ? sendJson(res, 410, { error: "Already played." })
      : sendJson(res, 404, { error: "Not available." });
  }
  return send(res, 200, claim.bytes, { "Content-Type": claim.type });
}

const NO_TTS = { engines: () => ({}), isValid: () => false, speak: async () => { throw new Error("no voice engine"); } };

export function createApp({ store, limiter, getPublicBase = () => null, tts = NO_TTS }) {
  return async function handle(req, res) {
    try {
      const pathname = req.url.split("?")[0];
      if (pathname === "/api/create") {
        if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
        return await create(req, res, { store, limiter, getPublicBase });
      }
      if (pathname === "/api/speak") {
        if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
        return await speak(req, res, { store, limiter, tts, getPublicBase });
      }
      if (pathname === "/api/engines") {
        if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed." });
        return sendJson(res, 200, tts.engines());
      }
      if (Object.hasOwn(STATIC, pathname)) return await serveStatic(req, res, STATIC[pathname]);
      const m = pathname.match(/^\/([A-Za-z0-9_-]{32})(\/play)?$/);
      if (m) return await player(req, res, store, m[1], Boolean(m[2]));
      return page(res, "This link is not available.", 404);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) sendJson(res, 500, { error: "Something went wrong." });
      else res.end();
    }
  };
}
