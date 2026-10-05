import { verifyTurnstile } from "./turnstile.js";
import { newToken } from "./token.js";
import { MAX_AUDIO_BYTES, RATE_LIMIT, RATE_WINDOW_MS, checkAudio } from "../public/limits.js";

export { Clip } from "./clip.js";
export { RateLimit } from "./ratelimit.js";

const SAFE = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex",
  "X-Content-Type-Options": "nosniff",
};

const json = (body, status = 200) => Response.json(body, { status, headers: SAFE });

const page = (text, status) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font:18px system-ui;text-align:center;padding:4rem">${text}`,
    { status, headers: { ...SAFE, "Content-Type": "text/html; charset=utf-8" } },
  );

const clipStub = (env, token) => env.CLIP.get(env.CLIP.idFromName(token));

async function sha256Hex(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function create(request, env, url, verify) {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_AUDIO_BYTES + 64 * 1024) return json({ error: "That file is too big (max 3 MB)." }, 413);

  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const limiter = env.RATE.get(env.RATE.idFromName(await sha256Hex(ip)));
  if (!(await limiter.hit(RATE_LIMIT, RATE_WINDOW_MS)).allowed) {
    return json({ error: "Too many links. Try again later." }, 429);
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "Send the audio as a form upload." }, 400);
  }
  const file = form.get("audio");
  if (!(file instanceof File)) return json({ error: "Choose an audio file." }, 400);

  const check = checkAudio({ size: file.size, type: file.type });
  if (!check.ok) return json({ error: check.error }, check.status);

  if (!(await verify(form.get("turnstile"), env.TURNSTILE_SECRET, ip))) {
    return json({ error: "CAPTCHA failed. Reload the page and try again." }, 403);
  }

  const token = newToken();
  await env.BUCKET.put(token, await file.arrayBuffer(), { httpMetadata: { contentType: check.type } });
  await clipStub(env, token).init(token, check.type);
  return json({ link: `${url.origin}/p/${token}` }, 201);
}

async function player(request, env, url) {
  const m = url.pathname.match(/^\/p\/([A-Za-z0-9_-]{32})(\/play)?$/);
  if (!m) return page("This link is not available.", 404);
  const [, token, isPlay] = m;
  const stub = clipStub(env, token);

  if (!isPlay) {
    if (request.method !== "GET" && request.method !== "HEAD") return json({ error: "Method not allowed." }, 405);
    const status = await stub.status();
    if (status === "played") return page("This voice note has already been played.", 410);
    if (status !== "unplayed") return page("This link is not available.", 404);
    const res = await env.ASSETS.fetch(new Request(new URL("/play.html", url)));
    return new Response(res.body, { status: 200, headers: { ...Object.fromEntries(res.headers), ...SAFE } });
  }

  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const claim = await stub.claim();
  if (!claim.ok) {
    return claim.reason === "played" ? json({ error: "Already played." }, 410) : json({ error: "Not available." }, 404);
  }
  const obj = await env.BUCKET.get(token);
  if (!obj) return json({ error: "Not available." }, 410);
  const bytes = await obj.arrayBuffer();
  await env.BUCKET.delete(token);
  return new Response(bytes, { headers: { ...SAFE, "Content-Type": claim.contentType } });
}

export async function handle(request, env, deps = {}) {
  const url = new URL(request.url);
  if (url.pathname === "/api/create") {
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
    return create(request, env, url, deps.verify ?? verifyTurnstile);
  }
  if (url.pathname.startsWith("/p/")) return player(request, env, url);
  return env.ASSETS.fetch(request);
}

export default {
  fetch: (request, env) => handle(request, env),
};
