# onetime-vn-web Node + quick-tunnel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Cloudflare Workers build with a plain Node server on the owner's Mac made public by a `cloudflared` quick tunnel, with links like `https://<words>.trycloudflare.com/<token>`, a nicer file input, the link shown as text, and no audio controller on the play page.

**Architecture:** A dependency-free Node HTTP server keeps clips in memory (atomic play-once, 24 hour expiry timers, a clip cap) and serves the existing static pages. A small module starts `cloudflared`, reads the public address from its output and falls back to local-only if it cannot. The browser still makes speech with Kokoro and now uploads the audio as a raw request body.

**Tech Stack:** Node 20+ (ES modules, built-in `http`, `fs`, `child_process`), Vitest 4 (dev only), `cloudflared` binary (quick tunnel, no account), kokoro-js in the browser.

**Spec:** `docs/superpowers/specs/2026-10-05-onetime-vn-web-node-design.md` (builds on `docs/superpowers/specs/2026-10-05-onetime-vn-web-design.md`)

## Global Constraints

- No runtime dependencies. Vitest is the only dependency, dev only.
- Audio at most 3 MB; types mp3, wav, ogg, m4a, webm; the 2 minute limit stays browser-side.
- Text and `.txt` at most 1,000 characters.
- Rate limit: 10 links per hour per client (`Cf-Connecting-Ip` header, else socket address).
- At most 100 unplayed clips stored at once; beyond that `503 "The server is busy. Try again later."`.
- Expiry 24 hours if never played. Audio freed right after the first play.
- Tokens are 32 URL-safe characters (192 bits). Static file names are never 32 characters long.
- Every response carries `Cache-Control: no-store`, `X-Robots-Tag: noindex`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`.
- Opening the play page must not consume the link. Only `POST /<token>/play` does.
- Link format: `<public base>/<token>`. Public base is the tunnel address if one exists, else the address the request arrived on.
- Server binds to `127.0.0.1` only. Port from `PORT` (default 8787). `NO_TUNNEL=1` disables the tunnel.
- The server never runs TTS and never stores text.
- Commit trailer on every commit: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- The owner does manual testing (look of the pages, drag and drop, Kokoro in the browser, iPhone, a real tunnel link from another device). The implementer writes and runs automated tests only.
- Work on branch `node-rewrite`.

## Review Focus

Inputs and conditions the spec implies but the tasks do not spell out, most likely first. Each has a test in the task named in brackets.

1. A chat app or browser prefetches the link (GET or HEAD) before the person clicks. The link must still work once. [Task 5]
2. Many people press Play at the same instant. Exactly one gets the audio. [Task 2 and Task 5]
3. An upload bigger than 3 MB with no `Content-Length` (chunked), or one that lies about its size. The server must answer 413 without buffering the whole body. [Task 4]
4. Odd paths: `/../server/app.js`, `/%2e%2e/server/app.js`, `//server/app.js`, `/package.json`, `/play.html`, a token with extra segments, wrong methods. Must return 404 or 405, never file contents and never a 500. [Task 4 and Task 5]
5. `cloudflared` is missing, slow, or exits. The server must keep running local-only and build links from the request address, not crash. [Task 6 and Task 7]

## File Structure

```
onetime-vn-web/
  package.json            scripts (start, test), vitest dev dependency
  vitest.config.js        plain Node test run
  .gitignore
  README.md
  server/
    token.js              newToken(), isToken()           (moved from src/)
    store.js              in-memory clips: add, status, claim, expire, cap, ttl
    ratelimit.js          createLimiter(): fixed-window counter
    app.js                createApp(): routes, static whitelist, create, play
    tunnel.js             parseTunnelUrl(), findCloudflared(), startTunnel()
    index.js              start(): wires everything, returns { close, ... }
    main.js               npm start entry: env, printing, signals
  public/
    limits.js             (unchanged)
    wav.js                (unchanged)
    create-logic.js       (unchanged)
    index.html            create page: drop area, link as text
    app.js                create page behaviour
    play.html             play page: no audio controller
    style.css             minimal styles
  test/
    helpers.js            test server, create(), newLink(), rawRequest()
    token.test.js  limits.test.js  wav.test.js  create-logic.test.js   (kept)
    store.test.js  ratelimit.test.js  app.test.js  tunnel.test.js
    index.test.js  pages.test.js
```

Removed: `wrangler.jsonc`, `src/worker.js`, `src/clip.js`, `src/ratelimit.js`, `src/turnstile.js`, `public/config.js`, `.dev.vars.example`, and the tests `smoke`, `clip`, `ratelimit` (Cloudflare version), `turnstile`, `worker`.

---

### Task 1: Remove Cloudflare, switch to a plain Node project

**Files:**
- Delete: `wrangler.jsonc`, `src/worker.js`, `src/clip.js`, `src/ratelimit.js`, `src/turnstile.js`, `public/config.js`, `.dev.vars.example`, `test/smoke.test.js`, `test/clip.test.js`, `test/ratelimit.test.js`, `test/turnstile.test.js`, `test/worker.test.js`
- Move: `src/token.js` to `server/token.js`
- Modify: `package.json`, `vitest.config.js`, `.gitignore`, `test/token.test.js`

**Interfaces:**
- Produces: `server/token.js` exporting `newToken(): string` and `isToken(s: string): boolean` (unchanged behaviour). A working `npm test` on plain Node running the kept suites (`token`, `limits`, `wav`, `create-logic`).

- [ ] **Step 1: Remove the Cloudflare files and move the token helper**

```bash
mkdir -p server
git mv src/token.js server/token.js
git rm -q wrangler.jsonc src/worker.js src/clip.js src/ratelimit.js src/turnstile.js public/config.js .dev.vars.example test/smoke.test.js test/clip.test.js test/ratelimit.test.js test/turnstile.test.js test/worker.test.js
rmdir src 2>/dev/null || true
rm -f .dev.vars; rm -rf .wrangler
```

- [ ] **Step 2: Rewrite `package.json`**

```json
{
  "name": "onetime-vn-web",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "start": "node server/main.js",
    "test": "vitest run"
  },
  "devDependencies": {
    "vitest": "^4.1.0"
  }
}
```

- [ ] **Step 3: Rewrite `vitest.config.js` and `.gitignore`**

`vitest.config.js`:
```js
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", include: ["test/**/*.test.js"] },
});
```

`.gitignore`:
```
node_modules/
```

- [ ] **Step 4: Point the token test at the new path**

In `test/token.test.js` change the import line to:
```js
import { newToken, isToken } from "../server/token.js";
```

- [ ] **Step 5: Reinstall without the Cloudflare packages and run the suite**

Run: `rm -rf node_modules package-lock.json && npm install && npm test`
Expected: 4 test files pass (token, limits, wav, create-logic), 20 tests. `npm ls` shows only vitest and its own dependencies.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: remove Cloudflare Workers build, plain Node project

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: In-memory clip store

**Files:**
- Create: `server/store.js`
- Test: `test/store.test.js`

**Interfaces:**
- Consumes: `TTL_MS` from `public/limits.js`.
- Produces: `createStore({ ttlMs?: number, maxUnplayed?: number }): Store` and `MAX_UNPLAYED = 100`. `Store` has `isFull(): boolean`, `add(token: string, bytes: Buffer, type: string): boolean` (false when full), `status(token): "unplayed" | "played" | "missing"`, `claim(token): { ok: true, bytes: Buffer, type: string } | { ok: false, reason: "played" | "missing" }`, `expire(token): void`, and a `size` getter (number of records).

- [ ] **Step 1: Write the failing tests `test/store.test.js`**

```js
import { describe, it, expect, vi, afterEach } from "vitest";
import { createStore } from "../server/store.js";

afterEach(() => vi.useRealTimers());

describe("store", () => {
  it("reports missing, then unplayed after add", () => {
    const s = createStore();
    expect(s.status("t")).toBe("missing");
    expect(s.add("t", Buffer.from([1]), "audio/wav")).toBe(true);
    expect(s.status("t")).toBe("unplayed");
  });

  it("lets the first claim win, hands over the bytes, and refuses the second", () => {
    const s = createStore();
    s.add("t", Buffer.from([1, 2, 3]), "audio/wav");
    const first = s.claim("t");
    expect(first.ok).toBe(true);
    expect([...first.bytes]).toEqual([1, 2, 3]);
    expect(first.type).toBe("audio/wav");
    expect(s.claim("t")).toEqual({ ok: false, reason: "played" });
    expect(s.status("t")).toBe("played");
  });

  it("refuses to claim a clip that does not exist", () => {
    expect(createStore().claim("nope")).toEqual({ ok: false, reason: "missing" });
  });

  it("lets exactly one of 10 simultaneous claims win", async () => {
    const s = createStore();
    s.add("t", Buffer.from([1]), "audio/wav");
    const results = await Promise.all(Array.from({ length: 10 }, async () => s.claim("t")));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.reason === "played")).toHaveLength(9);
  });

  it("refuses new clips when full, and a claim frees a slot", () => {
    const s = createStore({ maxUnplayed: 2 });
    expect(s.add("a", Buffer.from([1]), "audio/wav")).toBe(true);
    expect(s.add("b", Buffer.from([1]), "audio/wav")).toBe(true);
    expect(s.isFull()).toBe(true);
    expect(s.add("c", Buffer.from([1]), "audio/wav")).toBe(false);
    s.claim("a");
    expect(s.isFull()).toBe(false);
    expect(s.add("c", Buffer.from([1]), "audio/wav")).toBe(true);
  });

  it("expires an unplayed clip after the ttl and frees its slot", () => {
    vi.useFakeTimers();
    const s = createStore({ ttlMs: 1000, maxUnplayed: 1 });
    s.add("a", Buffer.from([1]), "audio/wav");
    expect(s.add("b", Buffer.from([1]), "audio/wav")).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(s.status("a")).toBe("missing");
    expect(s.add("b", Buffer.from([1]), "audio/wav")).toBe(true);
  });

  it("forgets a played clip at the ttl as well", () => {
    vi.useFakeTimers();
    const s = createStore({ ttlMs: 1000 });
    s.add("a", Buffer.from([1]), "audio/wav");
    s.claim("a");
    expect(s.size).toBe(1);
    vi.advanceTimersByTime(1000);
    expect(s.size).toBe(0);
    expect(s.status("a")).toBe("missing");
  });

  it("expire() removes a clip immediately and keeps the counters right", () => {
    const s = createStore({ maxUnplayed: 1 });
    s.add("a", Buffer.from([1]), "audio/wav");
    s.expire("a");
    expect(s.status("a")).toBe("missing");
    expect(s.add("b", Buffer.from([1]), "audio/wav")).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/store.test.js`
Expected: FAIL, `../server/store.js` not found.

- [ ] **Step 3: Write `server/store.js`**

```js
import { TTL_MS } from "../public/limits.js";

export const MAX_UNPLAYED = 100;

export function createStore({ ttlMs = TTL_MS, maxUnplayed = MAX_UNPLAYED } = {}) {
  const clips = new Map();
  let unplayed = 0;

  function drop(token) {
    const clip = clips.get(token);
    if (!clip) return;
    clearTimeout(clip.timer);
    if (clip.status === "unplayed") unplayed--;
    clips.delete(token);
  }

  return {
    isFull: () => unplayed >= maxUnplayed,

    add(token, bytes, type) {
      if (unplayed >= maxUnplayed) return false;
      const timer = setTimeout(() => drop(token), ttlMs);
      timer.unref?.();
      clips.set(token, { bytes, type, status: "unplayed", timer });
      unplayed++;
      return true;
    },

    status: (token) => clips.get(token)?.status ?? "missing",

    claim(token) {
      const clip = clips.get(token);
      if (!clip) return { ok: false, reason: "missing" };
      if (clip.status !== "unplayed") return { ok: false, reason: "played" };
      clip.status = "played";
      unplayed--;
      const { bytes, type } = clip;
      clip.bytes = null;
      return { ok: true, bytes, type };
    },

    expire: drop,

    get size() {
      return clips.size;
    },
  };
}
```

- [ ] **Step 4: Run to verify it passes, then run the whole suite**

Run: `npx vitest run test/store.test.js && npm test`
Expected: store tests pass (7), full suite green.

- [ ] **Step 5: Commit**

```bash
git add server/store.js test/store.test.js
git commit -m "feat: in-memory clip store with atomic claim, cap and expiry

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Rate limiter

**Files:**
- Create: `server/ratelimit.js`
- Test: `test/ratelimit.test.js`

**Interfaces:**
- Consumes: `RATE_LIMIT`, `RATE_WINDOW_MS` from `public/limits.js`.
- Produces: `createLimiter({ limit?: number, windowMs?: number, now?: () => number }): Limiter` with `hit(key: string): { allowed: boolean, remaining?: number }`, `prune(): void` (drops finished windows), and a `size` getter.

- [ ] **Step 1: Write the failing tests `test/ratelimit.test.js`**

```js
import { describe, it, expect } from "vitest";
import { createLimiter } from "../server/ratelimit.js";

describe("limiter", () => {
  it("allows up to the limit then refuses", () => {
    const l = createLimiter({ limit: 3 });
    expect([1, 2, 3].map(() => l.hit("a").allowed)).toEqual([true, true, true]);
    expect(l.hit("a").allowed).toBe(false);
  });

  it("counts remaining", () => {
    const l = createLimiter({ limit: 3 });
    expect(l.hit("a").remaining).toBe(2);
    expect(l.hit("a").remaining).toBe(1);
  });

  it("keeps different clients separate", () => {
    const l = createLimiter({ limit: 1 });
    l.hit("a");
    expect(l.hit("a").allowed).toBe(false);
    expect(l.hit("b").allowed).toBe(true);
  });

  it("starts a fresh window when the old one has ended", () => {
    let t = 1000;
    const l = createLimiter({ limit: 1, windowMs: 100, now: () => t });
    expect(l.hit("a").allowed).toBe(true);
    expect(l.hit("a").allowed).toBe(false);
    t += 100;
    expect(l.hit("a").allowed).toBe(true);
  });

  it("prunes finished windows only", () => {
    let t = 0;
    const l = createLimiter({ limit: 1, windowMs: 100, now: () => t });
    l.hit("old");
    t = 150;
    l.hit("new");
    l.prune();
    expect(l.size).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/ratelimit.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `server/ratelimit.js`**

```js
import { RATE_LIMIT, RATE_WINDOW_MS } from "../public/limits.js";

export function createLimiter({ limit = RATE_LIMIT, windowMs = RATE_WINDOW_MS, now = Date.now } = {}) {
  const windows = new Map();

  return {
    hit(key) {
      const t = now();
      let w = windows.get(key);
      if (!w || t >= w.start + windowMs) {
        w = { start: t, count: 0 };
        windows.set(key, w);
      }
      if (w.count >= limit) return { allowed: false };
      w.count += 1;
      return { allowed: true, remaining: limit - w.count };
    },

    prune() {
      const t = now();
      for (const [key, w] of windows) if (t >= w.start + windowMs) windows.delete(key);
    },

    get size() {
      return windows.size;
    },
  };
}
```

- [ ] **Step 4: Run to verify it passes, then commit**

Run: `npm test`
Expected: all green.

```bash
git add server/ratelimit.js test/ratelimit.test.js
git commit -m "feat: fixed-window rate limiter

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: HTTP app: static files and creating links

**Files:**
- Create: `server/app.js`, `test/helpers.js`
- Test: `test/app.test.js`

**Interfaces:**
- Consumes: `createStore` (`isFull`, `add`), `createLimiter` (`hit`), `checkAudio`, `MAX_AUDIO_BYTES`, `RATE_LIMIT` from `public/limits.js`, `newToken` from `server/token.js`.
- Produces: `createApp({ store, limiter, getPublicBase?: () => string | null }): (req, res) => Promise<void>`. Routes in this task: `GET|HEAD` of the static whitelist (`/`, `/index.html`, `/style.css`, `/app.js`, `/create-logic.js`, `/limits.js`, `/wav.js`) and `POST /api/create`. Everything else answers 404 (Task 5 adds the token routes). Test helpers: `startTestServer({ storeOptions?, limiterOptions?, getPublicBase? }): { base, store, limiter, close }`, `create(base, { bytes?, type?, ip? }): Promise<Response>`, `newLink(base, opts): Promise<string>`, `nextIp(): string`, `rawRequest(base, { method?, path?, headers?, chunks? }): Promise<{ status, headers, body }>`.

- [ ] **Step 1: Write `test/helpers.js`**

```js
import http from "node:http";
import { createApp } from "../server/app.js";
import { createStore } from "../server/store.js";
import { createLimiter } from "../server/ratelimit.js";

export async function startTestServer({ storeOptions, limiterOptions, getPublicBase } = {}) {
  const store = createStore(storeOptions);
  const limiter = createLimiter(limiterOptions);
  const server = http.createServer(createApp({ store, limiter, getPublicBase }));
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
```

- [ ] **Step 2: Write the failing tests `test/app.test.js`**

```js
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MAX_AUDIO_BYTES, RATE_LIMIT } from "../public/limits.js";
import { startTestServer, create, nextIp, rawRequest } from "./helpers.js";

let ctx;
beforeAll(async () => {
  ctx = await startTestServer();
});
afterAll(() => ctx.close());

describe("static files", () => {
  it("serves the create page at /", async () => {
    const res = await fetch(ctx.base + "/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    expect(await res.text()).toContain("One-time voice note");
  });

  it("serves the listed scripts and styles", async () => {
    for (const path of ["/app.js", "/create-logic.js", "/limits.js", "/wav.js", "/style.css"]) {
      const res = await fetch(ctx.base + path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("content-type"), path).toMatch(/javascript|css/);
    }
  });

  it("answers HEAD with headers and no body", async () => {
    const r = await rawRequest(ctx.base, { method: "HEAD", path: "/style.css" });
    expect(r.status).toBe(200);
    expect(r.body.length).toBe(0);
  });

  it("never serves anything outside the list", async () => {
    const paths = ["/../server/app.js", "/%2e%2e/server/app.js", "//server/app.js", "/server/app.js", "/package.json", "/play.html", "/test/helpers.js"];
    for (const path of paths) {
      const r = await rawRequest(ctx.base, { path });
      expect(r.status, path).toBe(404);
      expect(r.body.toString(), path).not.toContain("createApp");
    }
  });

  it("refuses POST on a static file with 405", async () => {
    expect((await fetch(ctx.base + "/app.js", { method: "POST" })).status).toBe(405);
  });
});

describe("POST /api/create", () => {
  it("stores the audio and returns a link on the request's own address", async () => {
    const res = await create(ctx.base);
    expect(res.status).toBe(201);
    const { link } = await res.json();
    expect(link).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]{32}$/);
    expect(ctx.store.status(link.split("/").pop())).toBe("unplayed");
  });

  it("uses the public tunnel address when there is one", async () => {
    const t = await startTestServer({ getPublicBase: () => "https://example-words.trycloudflare.com" });
    const { link } = await (await create(t.base)).json();
    expect(link).toMatch(/^https:\/\/example-words\.trycloudflare\.com\/[A-Za-z0-9_-]{32}$/);
    await t.close();
  });

  it("accepts a type with parameters and stores the clean type", async () => {
    const res = await create(ctx.base, { type: "audio/webm;codecs=opus" });
    expect(res.status).toBe(201);
  });

  it("rejects non-audio and a missing type with 415", async () => {
    expect((await create(ctx.base, { type: "text/html" })).status).toBe(415);
    expect((await create(ctx.base, { type: "" })).status).toBe(415);
  });

  it("rejects an empty body with 400", async () => {
    expect((await create(ctx.base, { bytes: new Uint8Array(0) })).status).toBe(400);
  });

  it("rejects a body over 3 MB with 413", async () => {
    expect((await create(ctx.base, { bytes: new Uint8Array(MAX_AUDIO_BYTES + 1) })).status).toBe(413);
  });

  it("accepts a body of exactly 3 MB", async () => {
    expect((await create(ctx.base, { bytes: new Uint8Array(MAX_AUDIO_BYTES) })).status).toBe(201);
  });

  it("cuts off a chunked upload over 3 MB that declares no size", async () => {
    const mb = Buffer.alloc(1024 * 1024);
    const r = await rawRequest(ctx.base, {
      method: "POST",
      path: "/api/create",
      headers: { "content-type": "audio/wav", "cf-connecting-ip": nextIp() },
      chunks: [mb, mb, mb, Buffer.alloc(1)],
    });
    expect(r.status).toBe(413);
  });

  it("refuses GET with 405", async () => {
    expect((await fetch(ctx.base + "/api/create")).status).toBe(405);
  });

  it("sends the safety headers", async () => {
    const res = await create(ctx.base);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("limits one client to 10 links per hour", async () => {
    const ip = nextIp();
    for (let i = 0; i < RATE_LIMIT; i++) expect((await create(ctx.base, { ip })).status).toBe(201);
    expect((await create(ctx.base, { ip })).status).toBe(429);
    expect((await create(ctx.base, { ip: nextIp() })).status).toBe(201);
  });

  it("answers 503 when the clip cap is reached", async () => {
    const t = await startTestServer({ storeOptions: { maxUnplayed: 1 } });
    expect((await create(t.base)).status).toBe(201);
    const res = await create(t.base);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/busy/i);
    await t.close();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run test/app.test.js`
Expected: FAIL, `../server/app.js` not found.

- [ ] **Step 4: Write `server/app.js` (static files and create; Task 5 adds the token routes)**

```js
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

// Reads the body but never keeps more than the audio limit. Does not use
// `for await ... return`, which would destroy the socket before we can answer.
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let over = Number(req.headers["content-length"] ?? 0) > MAX_AUDIO_BYTES;
    if (over) resolve(null);
    req.on("data", (chunk) => {
      size += chunk.length;
      if (over) {
        if (size > MAX_AUDIO_BYTES * 3) req.destroy();
        return;
      }
      if (size > MAX_AUDIO_BYTES) {
        over = true;
        chunks.length = 0;
        resolve(null);
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
```

Note: the create page file `public/index.html` still has the Cloudflare-era markup until Task 8; the tests above only check its title.

- [ ] **Step 5: Run to verify it passes, three times for stability**

Run: `for i in 1 2 3; do npx vitest run test/app.test.js 2>&1 | grep -E "FAIL|Tests"; done`
Expected: all three runs report 16 tests passed. If the chunked-upload or 3 MB test is flaky (`ECONNRESET`), fix the server, not the test: the server must respond before closing.

- [ ] **Step 6: Run the whole suite, then commit**

Run: `npm test`
Expected: all green.

```bash
git add server/app.js test/helpers.js test/app.test.js
git commit -m "feat: HTTP app with static whitelist and link creation

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: HTTP app: play page and play-once audio

**Files:**
- Modify: `server/app.js` (add the `player` function and the token route)
- Modify: `test/app.test.js` (append tests)

**Interfaces:**
- Consumes: `store.status`, `store.claim`, `store.expire`; helpers from Task 4.
- Produces: `GET|HEAD /<token>` (play page: 200 unplayed, 410 played, 404 otherwise), `POST /<token>/play` (200 with the audio once, then 410; 404 if unknown), 405 for wrong methods.

- [ ] **Step 1: Append the failing tests to `test/app.test.js`**

Add `newLink` to the helpers import line (`import { startTestServer, create, newLink, nextIp, rawRequest } from "./helpers.js";`) and append:

```js
const tokenOf = (link) => link.split("/").pop();
const play = (link) => fetch(link + "/play", { method: "POST" });

describe("play flow", () => {
  it("does not consume the link when the page is fetched, including HEAD", async () => {
    const link = await newLink(ctx.base);
    for (const method of ["GET", "GET", "HEAD"]) {
      const r = await fetch(link, { method });
      expect(r.status).toBe(200);
    }
    expect((await play(link)).status).toBe(200);
  });

  it("serves the play page as html", async () => {
    const link = await newLink(ctx.base);
    const res = await fetch(link);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    expect(await res.text()).toContain("Play");
  });

  it("serves the audio once with the right type and safe headers", async () => {
    const link = await newLink(ctx.base, { bytes: new Uint8Array([9, 8, 7]), type: "audio/webm;codecs=opus" });
    const res = await play(link);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/webm");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([9, 8, 7]);
    expect((await play(link)).status).toBe(410);
  });

  it("lets exactly one of 10 simultaneous plays win", async () => {
    const link = await newLink(ctx.base);
    const rs = await Promise.all(Array.from({ length: 10 }, () => play(link)));
    const codes = rs.map((r) => r.status);
    expect(codes.filter((c) => c === 200)).toHaveLength(1);
    expect(codes.filter((c) => c === 410)).toHaveLength(9);
    await Promise.all(rs.map((r) => r.arrayBuffer()));
  });

  it("shows 410 on the page after it was played", async () => {
    const link = await newLink(ctx.base);
    await play(link);
    expect((await fetch(link)).status).toBe(410);
  });

  it("answers 404 for a valid-looking token that never existed", async () => {
    const link = ctx.base + "/" + "a".repeat(32);
    expect((await fetch(link)).status).toBe(404);
    expect((await play(link)).status).toBe(404);
  });

  it("answers 404 after the clip expires", async () => {
    const link = await newLink(ctx.base);
    ctx.store.expire(tokenOf(link));
    expect((await fetch(link)).status).toBe(404);
    expect((await play(link)).status).toBe(404);
  });

  it("answers 404 or 405 for malformed paths and methods, never 500", async () => {
    const t = "a".repeat(32);
    for (const path of ["/short", "/" + "a".repeat(33), `/${t}/other`, `/${t}/play/more`, `/${t}/`]) {
      expect((await rawRequest(ctx.base, { path })).status, path).toBe(404);
    }
    expect((await rawRequest(ctx.base, { path: `/${t}/play` })).status).toBe(405);
    expect((await rawRequest(ctx.base, { method: "POST", path: `/${t}` })).status).toBe(405);
    expect((await rawRequest(ctx.base, { method: "DELETE", path: `/${t}` })).status).toBe(405);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/app.test.js`
Expected: the new "play flow" tests FAIL (the app answers 404 for tokens); the Task 4 tests still pass.

- [ ] **Step 3: Update `server/app.js`**

Add this function above `createApp`:

```js
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
```

In `createApp`, replace the line `return page(res, "This link is not available.", 404);` (after the static check) with:

```js
      const m = pathname.match(/^\/([A-Za-z0-9_-]{32})(\/play)?$/);
      if (m) return await player(req, res, store, m[1], Boolean(m[2]));
      return page(res, "This link is not available.", 404);
```

- [ ] **Step 4: Note on `public/play.html`**

`public/play.html` already exists from the earlier build, so the play-page tests can pass now. Task 8 rewrites it.

- [ ] **Step 5: Run to verify it passes, three times, then the whole suite**

Run: `for i in 1 2 3; do npx vitest run test/app.test.js 2>&1 | grep -E "FAIL|Tests"; done; npm test`
Expected: every run passes (24 tests in `app.test.js`); full suite green.

- [ ] **Step 6: Commit**

```bash
git add server/app.js test/app.test.js
git commit -m "feat: play page and play-once audio route

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Tunnel (cloudflared quick tunnel)

**Files:**
- Create: `server/tunnel.js`
- Test: `test/tunnel.test.js`

**Interfaces:**
- Produces: `parseTunnelUrl(text: string): string | null`, `findCloudflared(env?: object, exists?: (path: string) => boolean): string`, and `startTunnel(port: number, options?: { bin?: string, args?: string[], timeoutMs?: number }): Promise<{ url: string | null, stop: () => void }>`. `startTunnel` never rejects: a missing binary, an early exit or a timeout all resolve with `url: null`. `stop()` kills the child process whether or not a URL was found.

- [ ] **Step 1: Write the failing tests `test/tunnel.test.js`**

```js
import { describe, it, expect } from "vitest";
import { parseTunnelUrl, findCloudflared, startTunnel } from "../server/tunnel.js";

const node = process.execPath;
const script = (code) => ["-e", code];

describe("parseTunnelUrl", () => {
  it("finds the trycloudflare address in a log line", () => {
    const line = "2026-10-05T10:00:00Z INF |  https://quiet-river-demo-words.trycloudflare.com  |";
    expect(parseTunnelUrl(line)).toBe("https://quiet-river-demo-words.trycloudflare.com");
  });
  it("returns null when there is none", () => {
    expect(parseTunnelUrl("INF Requesting new quick Tunnel")).toBeNull();
    expect(parseTunnelUrl("https://example.com")).toBeNull();
  });
});

describe("findCloudflared", () => {
  it("prefers CLOUDFLARED_BIN", () => {
    expect(findCloudflared({ CLOUDFLARED_BIN: "/x/cf" }, () => true)).toBe("/x/cf");
  });
  it("uses the Homebrew path when it exists", () => {
    expect(findCloudflared({}, () => true)).toBe("/opt/homebrew/opt/cloudflared/bin/cloudflared");
  });
  it("falls back to PATH lookup", () => {
    expect(findCloudflared({}, () => false)).toBe("cloudflared");
  });
});

describe("startTunnel", () => {
  it("resolves with the address and can be stopped", async () => {
    const code = "console.error('INF https://fake-words-here.trycloudflare.com ok'); setInterval(()=>{},1000)";
    const t = await startTunnel(1234, { bin: node, args: script(code), timeoutMs: 5000 });
    expect(t.url).toBe("https://fake-words-here.trycloudflare.com");
    t.stop();
  });

  it("finds an address split across two chunks", async () => {
    const code = "process.stderr.write('https://split-wo'); setTimeout(()=>process.stderr.write('rds.trycloudflare.com\\n'),50); setInterval(()=>{},1000)";
    const t = await startTunnel(1234, { bin: node, args: script(code), timeoutMs: 5000 });
    expect(t.url).toBe("https://split-words.trycloudflare.com");
    t.stop();
  });

  it("resolves null when the binary is missing", async () => {
    const t = await startTunnel(1234, { bin: "definitely-not-installed-xyz", timeoutMs: 5000 });
    expect(t.url).toBeNull();
    t.stop();
  });

  it("resolves null when the process exits without an address", async () => {
    const t = await startTunnel(1234, { bin: node, args: script("process.exit(1)"), timeoutMs: 5000 });
    expect(t.url).toBeNull();
  });

  it("resolves null on timeout and still stops the process", async () => {
    const t = await startTunnel(1234, { bin: node, args: script("setInterval(()=>{},1000)"), timeoutMs: 200 });
    expect(t.url).toBeNull();
    t.stop();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/tunnel.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `server/tunnel.js`**

```js
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
```

- [ ] **Step 4: Run to verify it passes, then commit**

Run: `npx vitest run test/tunnel.test.js && npm test`
Expected: 10 tunnel tests pass; full suite green; no stray `node -e` processes left (`pgrep -f "setInterval" || echo clean`).

```bash
git add server/tunnel.js test/tunnel.test.js
git commit -m "feat: cloudflared quick tunnel starter that never throws

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Wiring: `start()` and `npm start`

**Files:**
- Create: `server/index.js`, `server/main.js`
- Test: `test/index.test.js`

**Interfaces:**
- Consumes: `createApp`, `createStore`, `createLimiter`, `startTunnel`.
- Produces: `start({ port?: number, tunnel?: boolean, tunnelOptions?: object, log?: (msg: string) => void }): Promise<{ port, localUrl, publicUrl, store, limiter, close(): Promise<void> }>`. Binds `127.0.0.1`. With `tunnel: true` it awaits `startTunnel` and uses its address for links. `close()` stops the tunnel, the prune timer and the server. `server/main.js` reads `PORT` and `NO_TUNNEL`, prints the addresses, handles `SIGINT`/`SIGTERM`, and prints a friendly message if the port is busy.

- [ ] **Step 1: Write the failing tests `test/index.test.js`**

```js
import { describe, it, expect, afterEach } from "vitest";
import { start } from "../server/index.js";
import { encodeWav16 } from "../public/wav.js";

const quiet = () => {};
let running;
afterEach(async () => {
  await running?.close();
  running = undefined;
});

const tone = () => new Uint8Array(encodeWav16(Float32Array.from({ length: 2400 }, (_, i) => Math.sin(i / 10) * 0.5), 24000));
const baseOf = (app) => `http://127.0.0.1:${app.port}`;
const createOn = (base) => fetch(base + "/api/create", { method: "POST", headers: { "content-type": "audio/wav" }, body: tone() });

describe("start", () => {
  it("runs the whole flow end to end without a tunnel", async () => {
    running = await start({ port: 0, tunnel: false, log: quiet });
    expect(running.publicUrl).toBeNull();
    const base = baseOf(running);

    expect((await fetch(base + "/")).status).toBe(200);

    const bytes = tone();
    const res = await fetch(base + "/api/create", { method: "POST", headers: { "content-type": "audio/wav" }, body: bytes });
    expect(res.status).toBe(201);
    const { link } = await res.json();
    expect(link.startsWith(base + "/")).toBe(true);

    expect((await fetch(link)).status).toBe(200);
    const played = await fetch(link + "/play", { method: "POST" });
    expect(played.status).toBe(200);
    expect(new Uint8Array(await played.arrayBuffer())).toEqual(bytes);
    expect((await fetch(link + "/play", { method: "POST" })).status).toBe(410);
    expect((await fetch(link)).status).toBe(410);
  });

  it("builds links on the tunnel address when the tunnel comes up", async () => {
    const code = "console.error('https://fake-words-here.trycloudflare.com'); setInterval(()=>{},1000)";
    running = await start({ port: 0, tunnel: true, tunnelOptions: { bin: process.execPath, args: ["-e", code], timeoutMs: 5000 }, log: quiet });
    expect(running.publicUrl).toBe("https://fake-words-here.trycloudflare.com");
    const { link } = await (await createOn(baseOf(running))).json();
    expect(link).toMatch(/^https:\/\/fake-words-here\.trycloudflare\.com\/[A-Za-z0-9_-]{32}$/);
  });

  it("keeps running local-only when cloudflared is missing", async () => {
    running = await start({ port: 0, tunnel: true, tunnelOptions: { bin: "definitely-not-installed-xyz", timeoutMs: 5000 }, log: quiet });
    expect(running.publicUrl).toBeNull();
    const res = await createOn(baseOf(running));
    expect(res.status).toBe(201);
    expect((await res.json()).link).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]{32}$/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/index.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `server/index.js`**

```js
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
```

- [ ] **Step 4: Write `server/main.js`**

```js
import { start } from "./index.js";

const port = Number(process.env.PORT ?? 8787);
const tunnel = process.env.NO_TUNNEL !== "1";

let app;
try {
  app = await start({ port, tunnel });
} catch (err) {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use. Stop the other server or run with PORT=<another port>.`);
  } else {
    console.error(err);
  }
  process.exit(1);
}

console.log(`Local:  ${app.localUrl}`);
if (app.publicUrl) {
  console.log(`Public: ${app.publicUrl}`);
  console.log("Links work only while this server and your Mac stay on. Restarting makes a new address and old links stop working.");
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run test/index.test.js && npm test`
Expected: 3 index tests pass; full suite green.

- [ ] **Step 6: Smoke the real command, local only**

Run: `PORT=8791 NO_TUNNEL=1 timeout 4 npm start 2>&1 | head -5; echo "exit ok"`
Expected: prints `Local:  http://localhost:8791` and no error. Then `PORT=8791 NO_TUNNEL=1 npm start & sleep 1; PORT=8791 NO_TUNNEL=1 npm start 2>&1 | head -2; kill %1` prints the "already in use" message from the second start.

- [ ] **Step 7: Commit**

```bash
git add server/index.js server/main.js test/index.test.js
git commit -m "feat: start() wiring and npm start entry with quick tunnel

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Pages: file drop area, link as text, play page without controls

**Files:**
- Modify: `public/index.html`, `public/app.js`, `public/style.css`, `public/play.html`
- Test: `test/pages.test.js`

**Interfaces:**
- Consumes: `POST /api/create` (raw body, `Content-Type` = audio type, returns `{ link }` or `{ error }`), `POST /<token>/play`, `pickSource` from `public/create-logic.js`, `encodeWav16` from `public/wav.js`, `MAX_AUDIO_BYTES`, `MAX_AUDIO_SECONDS` from `public/limits.js`.
- Produces: the two pages. The DOM behaviour cannot run in the Node test pool, so the automated test guards the markup rules the owner asked for and that the pages are served; the owner tests the look and behaviour by hand.

- [ ] **Step 1: Write the failing test `test/pages.test.js`**

```js
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (name) => readFileSync(new URL(`../public/${name}`, import.meta.url), "utf8");

describe("create page", () => {
  const html = read("index.html");
  it("has a styled drop area and a hidden native file input", () => {
    expect(html).toContain('id="drop"');
    expect(html).toMatch(/<input[^>]*id="file"[^>]*hidden/);
  });
  it("shows the link as a link, not in a text box", () => {
    expect(html).toMatch(/<a[^>]*id="link"/);
    expect(html).not.toMatch(/<input[^>]*id="link"/);
    expect(html).not.toContain("readonly");
  });
  it("has no CAPTCHA", () => {
    expect(html.toLowerCase()).not.toContain("turnstile");
    expect(html).not.toContain("config.js");
  });
});

describe("create page script", () => {
  const js = read("app.js");
  it("uploads the audio as a raw body and has no CAPTCHA or form upload", () => {
    expect(js).toContain('"/api/create"');
    expect(js).toContain("Content-Type");
    expect(js.toLowerCase()).not.toContain("turnstile");
    expect(js).not.toContain("FormData");
  });
});

describe("play page", () => {
  const html = read("play.html");
  it("shows no audio controller", () => {
    expect(html).not.toMatch(/\bcontrols\b/);
    expect(html).not.toMatch(/<audio/i);
  });
  it("has a Play button and posts to the play route", () => {
    expect(html).toContain('id="b"');
    expect(html).toContain('"/play"');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/pages.test.js`
Expected: FAIL (the old markup has a readonly link box, Turnstile and `<audio ... controls>`).

- [ ] **Step 3: Rewrite `public/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>One-time voice note</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
<main>
  <h1>One-time voice note</h1>
  <p class="sub">Type text or pick a file. Get a link that plays once.</p>
  <form id="f">
    <textarea id="text" rows="5" maxlength="1000" placeholder="Type something to say"></textarea>

    <label>Or use a .txt or audio file</label>
    <div id="drop" class="drop" tabindex="0" role="button" aria-label="Choose a .txt or audio file">
      <input id="file" type="file" accept=".txt,text/plain,audio/*" hidden>
      <span id="dropLabel">Choose a file, or drop it here</span>
      <span id="picked" hidden><span id="fileName"></span> <a href="#" id="clear">remove</a></span>
    </div>

    <label for="voice">Voice (for text)</label>
    <select id="voice">
      <option value="af_heart">Heart (female)</option>
      <option value="af_bella">Bella (female)</option>
      <option value="bf_emma">Emma (British, female)</option>
      <option value="am_michael">Michael (male)</option>
      <option value="am_onyx">Onyx (deep male)</option>
      <option value="bm_george">George (British, male)</option>
    </select>

    <button id="go" type="submit">Make link</button>
    <p id="msg" role="status"></p>
  </form>

  <div id="result" hidden>
    <a id="link" href="#" target="_blank" rel="noopener"></a>
    <button id="copy" type="button">Copy</button>
  </div>
</main>
<script type="module" src="/app.js"></script>
</body>
</html>
```

- [ ] **Step 4: Rewrite `public/app.js`**

```js
import { MAX_AUDIO_BYTES, MAX_AUDIO_SECONDS } from "/limits.js";
import { encodeWav16 } from "/wav.js";
import { pickSource } from "/create-logic.js";

const $ = (id) => document.getElementById(id);
const msg = $("msg");
const fileInput = $("file");
const drop = $("drop");

function renderPicked() {
  const file = fileInput.files[0];
  $("picked").hidden = !file;
  $("dropLabel").hidden = Boolean(file);
  $("fileName").textContent = file ? file.name : "";
}

drop.addEventListener("click", (e) => {
  if (e.target.id === "clear") return;
  fileInput.click();
});
drop.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fileInput.click();
  }
});
["dragenter", "dragover"].forEach((type) =>
  drop.addEventListener(type, (e) => {
    e.preventDefault();
    drop.classList.add("over");
  }),
);
["dragleave", "drop"].forEach((type) => drop.addEventListener(type, () => drop.classList.remove("over")));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  if (e.dataTransfer.files.length) {
    fileInput.files = e.dataTransfer.files;
    renderPicked();
  }
});
fileInput.addEventListener("change", renderPicked);
$("clear").addEventListener("click", (e) => {
  e.preventDefault();
  fileInput.value = "";
  renderPicked();
});

function audioSeconds(file) {
  return new Promise((resolve, reject) => {
    const a = new Audio();
    a.preload = "metadata";
    a.onloadedmetadata = () => {
      URL.revokeObjectURL(a.src);
      resolve(a.duration);
    };
    a.onerror = () => reject(new Error("Could not read that audio file."));
    a.src = URL.createObjectURL(file);
  });
}

async function synth(text, voice) {
  const { KokoroTTS } = await import("https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js");
  const device = navigator.gpu ? "webgpu" : "wasm";
  const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
    dtype: device === "webgpu" ? "fp32" : "q8",
    device,
  });
  const audio = await tts.generate(text, { voice });
  return new Blob([encodeWav16(audio.audio, audio.sampling_rate)], { type: "audio/wav" });
}

$("f").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("result").hidden = true;
  $("go").disabled = true;
  try {
    const file = fileInput.files[0];
    const fileText = file && !file.type.startsWith("audio/") ? await file.text() : undefined;
    const src = pickSource({ typedText: $("text").value, file, fileText });
    if (src.error) throw new Error(src.error);

    let blob;
    if (src.kind === "audio") {
      const secs = await audioSeconds(src.file);
      if (secs > MAX_AUDIO_SECONDS) throw new Error("Audio is too long (max 2 minutes).");
      blob = src.file;
    } else {
      msg.textContent = "Loading the voice. The first time can take a minute.";
      blob = await synth(src.text, $("voice").value);
      if (blob.size > MAX_AUDIO_BYTES) throw new Error("That text makes audio over 3 MB. Please use shorter text.");
    }

    msg.textContent = "Uploading.";
    const res = await fetch("/api/create", {
      method: "POST",
      headers: { "Content-Type": blob.type || "application/octet-stream" },
      body: blob,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Something went wrong.");

    $("link").href = data.link;
    $("link").textContent = data.link;
    $("copy").textContent = "Copy";
    $("result").hidden = false;
    msg.textContent = "Link ready. It plays once.";
  } catch (err) {
    msg.textContent = err.message;
  } finally {
    $("go").disabled = false;
  }
});

$("copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("link").href);
    $("copy").textContent = "Copied";
  } catch {
    msg.textContent = "Copy failed. Press and hold the link to copy it.";
  }
});
```

- [ ] **Step 5: Rewrite `public/play.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex">
  <meta name="referrer" content="no-referrer">
  <title>A voice note for you</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
<main class="center">
  <h1>You have a voice note</h1>
  <button id="b" type="button">Play</button>
  <p id="m">It can only be played once.</p>
</main>
<script>
const b = document.getElementById("b"), m = document.getElementById("m");
let audio = null;

b.onclick = async () => {
  if (audio) {
    // Autoplay was blocked: play what we already hold, without asking the server again.
    try {
      await audio.play();
      b.hidden = true;
      m.textContent = "Playing.";
    } catch {
      m.textContent = "Your browser would not play it. This note can't be opened again.";
    }
    return;
  }
  b.disabled = true;
  m.textContent = "Loading.";
  let r;
  try {
    r = await fetch(location.pathname + "/play", { method: "POST" });
  } catch {
    b.disabled = false;
    m.textContent = "Could not reach the server. Check your connection and try again.";
    return;
  }
  if (!r.ok) {
    b.hidden = true;
    m.textContent = r.status === 410 ? "This voice note has already been played." : "This link is not available.";
    return;
  }
  audio = new Audio(URL.createObjectURL(await r.blob()));
  audio.onended = () => {
    m.textContent = "That was it. This link is now closed.";
    b.hidden = true;
  };
  try {
    await audio.play();
    b.hidden = true;
    m.textContent = "Playing.";
  } catch {
    b.disabled = false;
    b.textContent = "Tap to play";
    m.textContent = "Your browser blocked autoplay. Tap to play. This note can't be opened again.";
  }
};
</script>
</body>
</html>
```

- [ ] **Step 6: Update `public/style.css`**

Replace the line starting `textarea, select, input[type="text"]` with:
```css
textarea, select { width: 100%; padding: .6rem; font: inherit; color: inherit; background: transparent; border: 1px solid var(--line); border-radius: 8px; }
```
Replace the two lines starting `#result {` and `#result button {` with:
```css
#result { margin-top: 1.5rem; display: flex; gap: .75rem; align-items: center; flex-wrap: wrap; }
#result button { margin-top: 0; }
#link { color: var(--ac); word-break: break-all; }
.drop { border: 1.5px dashed var(--line); border-radius: 12px; padding: 1.1rem; text-align: center; color: var(--muted); cursor: pointer; transition: border-color .15s, color .15s; }
.drop:hover, .drop:focus-visible, .drop.over { border-color: var(--ac); color: var(--fg); outline: none; }
.drop a { color: var(--ac); margin-left: .5rem; }
```

- [ ] **Step 7: Check syntax, run the page test and the suite**

Run: `for f in public/app.js public/wav.js public/create-logic.js; do node --input-type=module --check < $f && echo "ok $f"; done; npm test`
Expected: all three print `ok`; `pages.test.js` passes; full suite green.

- [ ] **Step 8: Check the pages are served by the real server**

Run: `PORT=8792 NO_TUNNEL=1 npm start > /tmp/ovw.log 2>&1 & sleep 1.5; for p in / /app.js /style.css; do echo "$p $(curl -s -o /dev/null -w '%{http_code}' http://localhost:8792$p)"; done; kill %1`
Expected: three `200` lines.

- [ ] **Step 9: Commit**

```bash
git add public test/pages.test.js
git commit -m "feat: drop-area file input, link as text, play page without audio controller

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: README and cleanup

**Files:**
- Modify: `README.md` (full rewrite)

- [ ] **Step 1: Rewrite `README.md`**

````markdown
# onetime-vn-web

Type text or pick a `.txt` or audio file. Get a link that plays once.
Text becomes speech in your browser (Kokoro). A small Node server on your Mac keeps the audio in memory, and a free `cloudflared` quick tunnel makes the links public. No account needed.

## Run

```bash
brew install cloudflared      # once, for the public links
npm install                   # once, installs the test runner only
npm start
```

It prints a local address (`http://localhost:8787`) and a public address like `https://some-words.trycloudflare.com`. Open either to make a link. Links look like `https://some-words.trycloudflare.com/<token>`.

Settings:
- `PORT=8800 npm start` to use another port.
- `NO_TUNNEL=1 npm start` to run on this Mac only (no public links).
- `CLOUDFLARED_BIN=/path/to/cloudflared` if the binary is somewhere unusual.

If `cloudflared` is missing or does not start, the server keeps running local-only and says so.

## Things to know

- Links work only while your Mac is awake and `npm start` is running.
- Restarting makes a new public address and loses all stored clips, so old links stop working.
- There is no CAPTCHA. Abuse protection is a limit of 10 links per hour per visitor and at most 100 unplayed clips stored at once.
- The first text-to-speech use downloads a model of about 90 MB.

## Limits

Text 1,000 characters. Audio 3 MB and 2 minutes (the 2 minute limit is checked in the browser). Types: mp3, wav, ogg, m4a, webm. Unplayed links expire after 24 hours; the audio is deleted right after the first play.

## Test

```bash
npm test
```

## Manual test checklist

1. Make a link from typed text. Open it in a private window. Press Play. It plays, with no player controls shown.
2. Open the same link again. It says it was already played.
3. Choose a `.txt` file and an mp3 with the file area, and again by dragging them onto it. Both make a link that plays once. Use "remove" to clear a chosen file.
4. The link appears as clickable text, not in a box. Copy puts it on the clipboard and says "Copied".
5. Paste a link into a chat app and check the preview does not use it up.
6. Try a file over 3 MB, a PDF, and 1,001 characters of text. Each shows a clear message.
7. Open a public link on a phone (Safari on iPhone included) over mobile data and press Play. If autoplay is blocked the button says "Tap to play".
8. Make 11 links quickly. The 11th is refused.
````

- [ ] **Step 2: Final checks**

Run: `npm test && grep -rIl -i -E "cloudflare|wrangler|turnstile" --exclude-dir=node_modules --exclude-dir=docs --exclude-dir=.git . | sort`
Expected: tests green. The grep lists only `README.md` and `server/tunnel.js` (the tunnel and `cloudflared` are still used on purpose). No `wrangler`, `Turnstile` or Workers references remain outside `docs/`.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README for the Node server and quick tunnel

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-review notes

- **Spec coverage:** removal of Cloudflare files and packages (Task 1); in-memory store with atomic claim, ttl and cap (Task 2); rate limit (Task 3); static whitelist, raw-body create, 413 cut-off, 503, safe headers, link on tunnel address or request address (Task 4); token routes with non-consuming page load, one winner, 404/405/410 rules (Task 5); tunnel start, parse, fallback (Task 6); `start()`, `npm start`, `PORT`, `NO_TUNNEL`, loopback bind, port-in-use message (Task 7); drop area, link as text, no CAPTCHA, no audio controller, raw upload, "Tap to play" retry (Task 8); README and manual checklist (Task 9).
- **Names match across tasks:** `createStore/isFull/add/status/claim/expire/size`, `createLimiter/hit/prune/size`, `createApp`, `parseTunnelUrl/findCloudflared/startTunnel`, `start`, helpers `startTestServer/create/newLink/nextIp/rawRequest`.
- **Not covered by automated tests:** the look of the pages, drag and drop, Kokoro in the browser, iPhone playback, and a real `cloudflared` tunnel opened from another device. They are in the owner's manual checklist.
- **Environment note for the executor:** the earlier Cloudflare build may still be running on port 8787 (`pgrep -f "wrangler dev"`). Stop it before the Task 7 smoke test or use another `PORT`.
