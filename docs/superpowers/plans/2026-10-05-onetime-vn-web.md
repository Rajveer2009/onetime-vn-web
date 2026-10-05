# onetime-vn-web Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A minimal public website where anyone enters text, a `.txt` file or an audio file and gets a link that plays the voice note exactly once.

**Architecture:** A Cloudflare Worker serves a static create page and a play page. Text becomes speech in the visitor's browser (kokoro-js), so the server never runs TTS. Audio is stored in R2 under a random token. One Durable Object per clip makes "play once" exact; a second Durable Object per hashed IP does rate limiting.

**Tech Stack:** Plain JavaScript (ES modules), Cloudflare Workers + R2 + Durable Objects, Wrangler 4.147.0, Vitest 4 with `@cloudflare/vitest-plugin` 1.3.6, kokoro-js 1.2.1 (browser, from jsDelivr), Cloudflare Turnstile.

**Spec:** `docs/superpowers/specs/2026-10-05-onetime-vn-web-design.md`

## Global Constraints

- Plain JavaScript, no framework, minimal design.
- Text and `.txt` file: at most 1,000 characters.
- Audio: at most 3 MB and 2 minutes. Accepted types: mp3, wav, ogg, m4a, webm.
- Rate limit: 10 links per hour per IP address.
- Turnstile required on creation.
- Expiry: 24 hours if never played. Audio deleted right after the first play.
- Tokens have at least 128 bits of randomness (this plan uses 192). Responses carry `Cache-Control: no-store` and `X-Robots-Tag: noindex`.
- Opening the play page must not consume the link. Only the Play button's `POST` does.
- The server never runs TTS and never stores text.
- Error messages are plain sentences: too big, wrong file type, rate limit, CAPTCHA failed, already played (410), not found or expired (404).
- Commit trailer on every commit: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- The owner does the manual browser test. The implementer writes and runs the automated tests only.

## Known deviation from the spec

The server can only enforce the 3 MB size cap and the type list. The **2 minute** audio limit is enforced in the browser (Task 6) because decoding audio duration on the server is out of scope. The 3 MB cap is the hard server-side bound.

## Review Focus

Inputs and conditions the spec implies but does not spell out, most likely first. Each has a test in the task named in brackets.

1. A chat app or browser prefetches the link (GET or HEAD) before the person clicks. The link must still work once. [Task 7]
2. Two people press Play at the same instant. Exactly one gets the audio. [Task 3 and Task 7]
3. The browser reports a type with parameters (`audio/webm;codecs=opus`) or an odd one (`audio/mp3`). Valid audio must not be rejected for that. [Task 2 and Task 7]
4. An empty file, a missing file field, or a non-form POST. Must return a clear 400, never a 500. [Task 2 and Task 7]
5. Garbage or malformed link paths (wrong length, extra segments, wrong method). Must return 404 or 405, never a 500, and must not create storage. [Task 7]

## File Structure

```
onetime-vn-web/
  package.json            scripts and dev dependencies
  wrangler.jsonc          Worker, assets, R2, Durable Object config
  vitest.config.js        test runner using the Workers pool
  .gitignore
  .dev.vars.example       local Turnstile test secret
  README.md               run, test, deploy, manual test checklist
  src/
    worker.js             routes + exports the two Durable Object classes
    clip.js               Clip Durable Object: play-once state, expiry
    ratelimit.js          RateLimit Durable Object: fixed-window counter
    turnstile.js          verifyTurnstile()
    token.js              newToken(), isToken()
  public/
    limits.js             constants + checkAudio(), shared by Worker and browser
    create-logic.js       pickSource(): which input to use, pure
    index.html            create page
    app.js                create page behaviour (TTS, upload, show link)
    play.html             play page
    style.css             minimal styles
    config.js             Turnstile site key
  test/
    smoke.test.js
    limits.test.js
    token.test.js
    clip.test.js
    ratelimit.test.js
    turnstile.test.js
    create-logic.test.js
    worker.test.js
```

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `wrangler.jsonc`, `vitest.config.js`, `.gitignore`, `.dev.vars.example`, `public/.gitkeep`, `src/worker.js`, `test/smoke.test.js`

**Interfaces:**
- Produces: a working `npm test` that runs inside the Workers runtime; `src/worker.js` default export with a `fetch` handler (replaced in Task 7).

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "onetime-vn-web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "test": "vitest run",
    "deploy": "wrangler deploy"
  },
  "devDependencies": {
    "@cloudflare/vitest-plugin": "1.3.6",
    "vitest": "^4.1.0",
    "wrangler": "4.147.0"
  }
}
```

- [ ] **Step 2: Write `wrangler.jsonc`**

```jsonc
{
  "name": "onetime-vn-web",
  "main": "src/worker.js",
  "compatibility_date": "2026-09-01",
  "assets": {
    "directory": "./public",
    "binding": "ASSETS",
    "html_handling": "none",
    "not_found_handling": "none",
    "run_worker_first": ["/api/*", "/p/*"]
  }
}
```

- [ ] **Step 3: Write `vitest.config.js`**

```js
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
});
```

- [ ] **Step 4: Write `.gitignore`, `.dev.vars.example`, `public/.gitkeep`, `src/worker.js`**

`.gitignore`:
```
node_modules/
.wrangler/
.dev.vars
```

`.dev.vars.example` (Cloudflare's published Turnstile test secret that always passes):
```
TURNSTILE_SECRET=1x0000000000000000000000000000000AA
```

`public/.gitkeep`: empty file.

`src/worker.js`:
```js
export default {
  async fetch() {
    return new Response("Not found", { status: 404 });
  },
};
```

- [ ] **Step 5: Write the failing smoke test `test/smoke.test.js`**

```js
import { exports } from "cloudflare:workers";
import { describe, it, expect } from "vitest";

describe("worker boots", () => {
  it("answers 404 for an unknown path", async () => {
    const res = await exports.default.fetch("http://example.com/api/nope");
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not found");
  });
});
```

- [ ] **Step 6: Install and run the test**

Run: `npm install && npm test`
Expected: 1 test passes. If `compatibility_date` is rejected as too new, change it to the newest date the installed workerd accepts (the error names it) and re-run.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold Worker project with Vitest Workers pool

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Shared limits and tokens

**Files:**
- Create: `public/limits.js`, `src/token.js`
- Test: `test/limits.test.js`, `test/token.test.js`

**Interfaces:**
- Produces from `public/limits.js`: constants `MAX_TEXT_CHARS = 1000`, `MAX_AUDIO_BYTES = 3145728`, `MAX_AUDIO_SECONDS = 120`, `RATE_LIMIT = 10`, `RATE_WINDOW_MS = 3600000`, `TTL_MS = 86400000`, `ALLOWED_AUDIO_TYPES` (string array); functions `normalizeType(type: string): string` and `checkAudio({ size: number, type: string }): { ok: true, type: string } | { ok: false, status: number, error: string }`.
- Produces from `src/token.js`: `newToken(): string` (32 chars of `A-Za-z0-9_-`) and `isToken(s: string): boolean`.

- [ ] **Step 1: Write the failing tests**

`test/limits.test.js`:
```js
import { describe, it, expect } from "vitest";
import { MAX_AUDIO_BYTES, normalizeType, checkAudio } from "../public/limits.js";

describe("normalizeType", () => {
  it("drops parameters and lowercases", () => {
    expect(normalizeType("Audio/WebM;codecs=opus")).toBe("audio/webm");
  });
  it("handles missing types", () => {
    expect(normalizeType(undefined)).toBe("");
    expect(normalizeType("")).toBe("");
  });
});

describe("checkAudio", () => {
  it("accepts a normal wav", () => {
    expect(checkAudio({ size: 1000, type: "audio/wav" })).toEqual({ ok: true, type: "audio/wav" });
  });
  it("accepts types with parameters and the odd mp3 name", () => {
    expect(checkAudio({ size: 10, type: "audio/webm;codecs=opus" })).toEqual({ ok: true, type: "audio/webm" });
    expect(checkAudio({ size: 10, type: "audio/mp3" }).ok).toBe(true);
  });
  it("accepts exactly the size cap and rejects one byte more", () => {
    expect(checkAudio({ size: MAX_AUDIO_BYTES, type: "audio/wav" }).ok).toBe(true);
    const r = checkAudio({ size: MAX_AUDIO_BYTES + 1, type: "audio/wav" });
    expect(r).toMatchObject({ ok: false, status: 413 });
  });
  it("rejects an empty file with 400", () => {
    expect(checkAudio({ size: 0, type: "audio/wav" })).toMatchObject({ ok: false, status: 400 });
  });
  it("rejects non-audio and missing types with 415", () => {
    expect(checkAudio({ size: 10, type: "text/html" })).toMatchObject({ ok: false, status: 415 });
    expect(checkAudio({ size: 10, type: "" })).toMatchObject({ ok: false, status: 415 });
  });
});
```

`test/token.test.js`:
```js
import { describe, it, expect } from "vitest";
import { newToken, isToken } from "../src/token.js";

describe("tokens", () => {
  it("makes 32-character url-safe tokens", () => {
    for (let i = 0; i < 50; i++) expect(newToken()).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });
  it("makes unique tokens", () => {
    const seen = new Set(Array.from({ length: 1000 }, newToken));
    expect(seen.size).toBe(1000);
  });
  it("isToken accepts only the exact shape", () => {
    expect(isToken(newToken())).toBe(true);
    expect(isToken("a".repeat(31))).toBe(false);
    expect(isToken("a".repeat(33))).toBe(false);
    expect(isToken("a".repeat(31) + "+")).toBe(false);
    expect(isToken("../".padEnd(32, "a"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/limits.test.js test/token.test.js`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write `public/limits.js`**

```js
export const MAX_TEXT_CHARS = 1000;
export const MAX_AUDIO_BYTES = 3 * 1024 * 1024;
export const MAX_AUDIO_SECONDS = 120;
export const RATE_LIMIT = 10;
export const RATE_WINDOW_MS = 60 * 60 * 1000;
export const TTL_MS = 24 * 60 * 60 * 1000;

export const ALLOWED_AUDIO_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/ogg",
  "audio/mp4",
  "audio/x-m4a",
  "audio/webm",
];

export function normalizeType(type) {
  return String(type ?? "").split(";")[0].trim().toLowerCase();
}

export function checkAudio({ size, type }) {
  const t = normalizeType(type);
  if (!size) return { ok: false, status: 400, error: "The audio file is empty." };
  if (size > MAX_AUDIO_BYTES) return { ok: false, status: 413, error: "That file is too big (max 3 MB)." };
  if (!ALLOWED_AUDIO_TYPES.includes(t)) {
    return { ok: false, status: 415, error: "Unsupported audio type. Use mp3, wav, ogg, m4a or webm." };
  }
  return { ok: true, type: t };
}
```

- [ ] **Step 4: Write `src/token.js`**

```js
export function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_");
}

export const isToken = (s) => /^[A-Za-z0-9_-]{32}$/.test(s);
```

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run test/limits.test.js test/token.test.js`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add public/limits.js src/token.js test/limits.test.js test/token.test.js
git commit -m "feat: shared limits, audio validation and token helpers

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Clip Durable Object (play-once state and expiry)

**Files:**
- Create: `src/clip.js`
- Modify: `wrangler.jsonc` (add R2 bucket, Clip Durable Object, migration)
- Test: `test/clip.test.js`

**Interfaces:**
- Consumes: `TTL_MS` from `public/limits.js`.
- Produces: class `Clip extends DurableObject` with RPC methods `init(token: string, contentType: string): Promise<void>`, `status(): Promise<"unplayed" | "played" | "missing">`, `claim(): Promise<{ ok: true, contentType: string } | { ok: false, reason: "played" | "missing" }>`, `expiresAt(): Promise<number | null>`, `expire(): Promise<void>`, and `alarm()` which calls `expire()`. Bindings used: `env.BUCKET` (R2), `env.CLIP` (namespace).

- [ ] **Step 1: Replace `wrangler.jsonc` with the version that has R2 and the Clip object**

```jsonc
{
  "name": "onetime-vn-web",
  "main": "src/worker.js",
  "compatibility_date": "2026-09-01",
  "assets": {
    "directory": "./public",
    "binding": "ASSETS",
    "html_handling": "none",
    "not_found_handling": "none",
    "run_worker_first": ["/api/*", "/p/*"]
  },
  "r2_buckets": [{ "binding": "BUCKET", "bucket_name": "onetime-vn-web-audio" }],
  "durable_objects": {
    "bindings": [{ "name": "CLIP", "class_name": "Clip" }]
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["Clip"] }]
}
```

Also change `src/worker.js` so the config loads (the class must be exported):
```js
export { Clip } from "./clip.js";

export default {
  async fetch() {
    return new Response("Not found", { status: 404 });
  },
};
```

- [ ] **Step 2: Write the failing tests `test/clip.test.js`**

```js
import { env } from "cloudflare:workers";
import { describe, it, expect } from "vitest";
import { newToken } from "../src/token.js";
import { TTL_MS } from "../public/limits.js";

const stubFor = (token) => env.CLIP.get(env.CLIP.idFromName(token));

describe("Clip", () => {
  it("reports missing before init and unplayed after", async () => {
    const t = newToken();
    const clip = stubFor(t);
    expect(await clip.status()).toBe("missing");
    await clip.init(t, "audio/wav");
    expect(await clip.status()).toBe("unplayed");
  });

  it("lets the first claim win and refuses the second", async () => {
    const t = newToken();
    const clip = stubFor(t);
    await clip.init(t, "audio/wav");
    expect(await clip.claim()).toEqual({ ok: true, contentType: "audio/wav" });
    expect(await clip.claim()).toEqual({ ok: false, reason: "played" });
    expect(await clip.status()).toBe("played");
  });

  it("refuses to claim a clip that was never created", async () => {
    const clip = stubFor(newToken());
    expect(await clip.claim()).toEqual({ ok: false, reason: "missing" });
  });

  it("lets exactly one of 20 simultaneous claims win", async () => {
    const t = newToken();
    const clip = stubFor(t);
    await clip.init(t, "audio/wav");
    const results = await Promise.all(Array.from({ length: 20 }, () => clip.claim()));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.reason === "played")).toHaveLength(19);
  });

  it("schedules expiry about 24 hours out", async () => {
    const t = newToken();
    const clip = stubFor(t);
    const before = Date.now();
    await clip.init(t, "audio/wav");
    const at = await clip.expiresAt();
    expect(at).toBeGreaterThanOrEqual(before + TTL_MS);
    expect(at).toBeLessThan(before + TTL_MS + 60_000);
  });

  it("expire() deletes the stored audio and forgets the clip", async () => {
    const t = newToken();
    await env.BUCKET.put(t, new Uint8Array([1, 2, 3]));
    const clip = stubFor(t);
    await clip.init(t, "audio/wav");
    await clip.expire();
    expect(await env.BUCKET.get(t)).toBeNull();
    expect(await clip.status()).toBe("missing");
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run test/clip.test.js`
Expected: FAIL (`src/clip.js` not found).

- [ ] **Step 4: Write `src/clip.js`**

```js
import { DurableObject } from "cloudflare:workers";
import { TTL_MS } from "../public/limits.js";

export class Clip extends DurableObject {
  async init(token, contentType) {
    await this.ctx.storage.put({ token, contentType, status: "unplayed" });
    await this.ctx.storage.setAlarm(Date.now() + TTL_MS);
  }

  async status() {
    return (await this.ctx.storage.get("status")) ?? "missing";
  }

  async claim() {
    return this.ctx.blockConcurrencyWhile(async () => {
      const status = (await this.ctx.storage.get("status")) ?? "missing";
      if (status !== "unplayed") return { ok: false, reason: status };
      await this.ctx.storage.put("status", "played");
      return { ok: true, contentType: await this.ctx.storage.get("contentType") };
    });
  }

  async expiresAt() {
    return this.ctx.storage.getAlarm();
  }

  async expire() {
    const token = await this.ctx.storage.get("token");
    if (token) await this.env.BUCKET.delete(token);
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  async alarm() {
    await this.expire();
  }
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run test/clip.test.js`
Expected: 6 tests pass. If `deleteAll` runs before `deleteAlarm` problems appear, keep the order shown (alarm first, then data).

- [ ] **Step 6: Run the whole suite, then commit**

Run: `npm test`
Expected: all green.

```bash
git add wrangler.jsonc src/worker.js src/clip.js test/clip.test.js
git commit -m "feat: Clip Durable Object with exact play-once claim and 24h expiry

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: RateLimit Durable Object

**Files:**
- Create: `src/ratelimit.js`
- Modify: `wrangler.jsonc` (add RATE binding and migration v2), `src/worker.js` (export class)
- Test: `test/ratelimit.test.js`

**Interfaces:**
- Produces: class `RateLimit extends DurableObject` with `hit(limit: number, windowMs: number): Promise<{ allowed: boolean, remaining?: number }>` and `alarm()` which clears its storage. Binding `env.RATE`.

- [ ] **Step 1: Update `wrangler.jsonc` durable object section**

Replace the `durable_objects` and `migrations` keys with:
```jsonc
  "durable_objects": {
    "bindings": [
      { "name": "CLIP", "class_name": "Clip" },
      { "name": "RATE", "class_name": "RateLimit" }
    ]
  },
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["Clip"] },
    { "tag": "v2", "new_sqlite_classes": ["RateLimit"] }
  ]
```

Update `src/worker.js` first line to export both:
```js
export { Clip } from "./clip.js";
export { RateLimit } from "./ratelimit.js";
```
(keep the default export below it unchanged).

- [ ] **Step 2: Write the failing tests `test/ratelimit.test.js`**

```js
import { env } from "cloudflare:workers";
import { describe, it, expect } from "vitest";

const limiter = (name) => env.RATE.get(env.RATE.idFromName(name));

describe("RateLimit", () => {
  it("allows up to the limit and then refuses", async () => {
    const r = limiter("ip-a");
    for (let i = 0; i < 10; i++) expect((await r.hit(10, 3_600_000)).allowed).toBe(true);
    expect((await r.hit(10, 3_600_000)).allowed).toBe(false);
  });

  it("keeps different callers separate", async () => {
    const a = limiter("ip-b");
    const b = limiter("ip-c");
    await a.hit(1, 3_600_000);
    expect((await a.hit(1, 3_600_000)).allowed).toBe(false);
    expect((await b.hit(1, 3_600_000)).allowed).toBe(true);
  });

  it("starts a fresh window when the old one has ended", async () => {
    const r = limiter("ip-d");
    expect((await r.hit(1, 0)).allowed).toBe(true);
    expect((await r.hit(1, 0)).allowed).toBe(true);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run test/ratelimit.test.js`
Expected: FAIL (module missing).

- [ ] **Step 4: Write `src/ratelimit.js`**

```js
import { DurableObject } from "cloudflare:workers";

export class RateLimit extends DurableObject {
  async hit(limit, windowMs) {
    const now = Date.now();
    let w = await this.ctx.storage.get("w");
    if (!w || now >= w.start + windowMs) {
      w = { start: now, count: 0 };
      await this.ctx.storage.setAlarm(now + windowMs);
    }
    if (w.count >= limit) {
      await this.ctx.storage.put("w", w);
      return { allowed: false };
    }
    w.count += 1;
    await this.ctx.storage.put("w", w);
    return { allowed: true, remaining: limit - w.count };
  }

  async alarm() {
    await this.ctx.storage.deleteAll();
  }
}
```

- [ ] **Step 5: Run to verify it passes, then commit**

Run: `npm test`
Expected: all green.

```bash
git add wrangler.jsonc src/worker.js src/ratelimit.js test/ratelimit.test.js
git commit -m "feat: RateLimit Durable Object with fixed one-hour windows

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Turnstile verification

**Files:**
- Create: `src/turnstile.js`
- Test: `test/turnstile.test.js`

**Interfaces:**
- Produces: `verifyTurnstile(token: string | null, secret: string | undefined, ip: string | undefined, fetchFn?: typeof fetch): Promise<boolean>`. Returns `false` on missing token or secret, a failed check, or any network or parse error.

- [ ] **Step 1: Write the failing tests**

```js
import { describe, it, expect } from "vitest";
import { verifyTurnstile } from "../src/turnstile.js";

const fake = (result) => {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, body: init.body });
    if (result instanceof Error) throw result;
    return new Response(JSON.stringify(result));
  };
  fn.calls = calls;
  return fn;
};

describe("verifyTurnstile", () => {
  it("returns true when Cloudflare says success and sends the right fields", async () => {
    const f = fake({ success: true });
    expect(await verifyTurnstile("tok", "sec", "1.2.3.4", f)).toBe(true);
    expect(f.calls[0].url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(f.calls[0].body.get("secret")).toBe("sec");
    expect(f.calls[0].body.get("response")).toBe("tok");
    expect(f.calls[0].body.get("remoteip")).toBe("1.2.3.4");
  });

  it("returns false when Cloudflare says failure", async () => {
    expect(await verifyTurnstile("tok", "sec", "1.2.3.4", fake({ success: false }))).toBe(false);
  });

  it("returns false without calling Cloudflare when the token or secret is missing", async () => {
    const f = fake({ success: true });
    expect(await verifyTurnstile("", "sec", "ip", f)).toBe(false);
    expect(await verifyTurnstile(null, "sec", "ip", f)).toBe(false);
    expect(await verifyTurnstile("tok", undefined, "ip", f)).toBe(false);
    expect(f.calls).toHaveLength(0);
  });

  it("returns false when the network call throws", async () => {
    expect(await verifyTurnstile("tok", "sec", "ip", fake(new Error("down")))).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/turnstile.test.js`
Expected: FAIL (module missing).

- [ ] **Step 3: Write `src/turnstile.js`**

```js
export async function verifyTurnstile(token, secret, ip, fetchFn = fetch) {
  if (!token || !secret) return false;
  const body = new URLSearchParams({ secret, response: token });
  if (ip) body.set("remoteip", ip);
  try {
    const res = await fetchFn("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
    });
    const data = await res.json();
    return data.success === true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run to verify it passes, then commit**

Run: `npm test`
Expected: all green.

```bash
git add src/turnstile.js test/turnstile.test.js
git commit -m "feat: Turnstile server-side verification

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Browser pages (create, play, styles)

**Files:**
- Create: `public/create-logic.js`, `public/index.html`, `public/app.js`, `public/play.html`, `public/style.css`, `public/config.js`
- Delete: `public/.gitkeep`
- Test: `test/create-logic.test.js`

**Interfaces:**
- Consumes: `MAX_TEXT_CHARS`, `MAX_AUDIO_SECONDS` from `public/limits.js`.
- Produces: `pickSource({ typedText, file, fileText }): { kind: "text", text } | { kind: "audio", file } | { error }`. The API contract with the Worker: `POST /api/create` multipart form with fields `audio` (file) and `turnstile` (token); success is `201 { link }`, failure is `{ error }` with a status code. Play contract: `GET /p/<token>` page, `POST /p/<token>/play` returns the audio bytes.

- [ ] **Step 1: Write the failing tests `test/create-logic.test.js`**

```js
import { describe, it, expect } from "vitest";
import { pickSource } from "../public/create-logic.js";
import { MAX_TEXT_CHARS } from "../public/limits.js";

const file = (name, type) => ({ name, type });

describe("pickSource", () => {
  it("uses typed text when no file is chosen", () => {
    expect(pickSource({ typedText: "  hello  " })).toEqual({ kind: "text", text: "hello" });
  });
  it("asks for input when everything is empty", () => {
    expect(pickSource({ typedText: "   " })).toEqual({ error: "Type some text or choose a file." });
    expect(pickSource({})).toEqual({ error: "Type some text or choose a file." });
  });
  it("rejects text over the limit", () => {
    const r = pickSource({ typedText: "a".repeat(MAX_TEXT_CHARS + 1) });
    expect(r.error).toMatch(/too long/);
    expect(pickSource({ typedText: "a".repeat(MAX_TEXT_CHARS) }).kind).toBe("text");
  });
  it("prefers a chosen file over typed text", () => {
    const f = file("a.mp3", "audio/mpeg");
    expect(pickSource({ typedText: "ignored", file: f })).toEqual({ kind: "audio", file: f });
  });
  it("reads a .txt file by type or by name", () => {
    expect(pickSource({ file: file("n.txt", "text/plain"), fileText: " hi " })).toEqual({ kind: "text", text: "hi" });
    expect(pickSource({ file: file("n.TXT", ""), fileText: "yo" })).toEqual({ kind: "text", text: "yo" });
  });
  it("rejects an empty or oversize .txt file", () => {
    expect(pickSource({ file: file("n.txt", "text/plain"), fileText: "  " }).error).toBeTruthy();
    expect(pickSource({ file: file("n.txt", "text/plain"), fileText: "a".repeat(MAX_TEXT_CHARS + 1) }).error).toMatch(/too long/);
  });
  it("rejects other file types", () => {
    expect(pickSource({ file: file("a.pdf", "application/pdf") })).toEqual({ error: "Choose a .txt file or an audio file." });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/create-logic.test.js`
Expected: FAIL (module missing).

- [ ] **Step 3: Write `public/create-logic.js`**

```js
import { MAX_TEXT_CHARS } from "./limits.js";

function fromText(raw) {
  const text = (raw ?? "").trim();
  if (!text) return { error: "Type some text or choose a file." };
  if (text.length > MAX_TEXT_CHARS) return { error: `Text is too long (max ${MAX_TEXT_CHARS} characters).` };
  return { kind: "text", text };
}

export function pickSource({ typedText, file, fileText }) {
  if (!file) return fromText(typedText);
  if (file.type.startsWith("audio/")) return { kind: "audio", file };
  if (file.type === "text/plain" || file.name.toLowerCase().endsWith(".txt")) return fromText(fileText);
  return { error: "Choose a .txt file or an audio file." };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/create-logic.test.js`
Expected: all pass.

- [ ] **Step 5: Write `public/config.js`**

```js
// Turnstile site key (public). This is Cloudflare's test key that always passes.
// Replace it with your real site key before deploying.
window.TURNSTILE_SITE_KEY = "1x00000000000000000000AA";
```

- [ ] **Step 6: Write `public/style.css`**

```css
:root { --bg: #f7f6f2; --fg: #1d1c1a; --muted: #6b6963; --line: #d8d5cc; --ac: #2f6f5e; }
@media (prefers-color-scheme: dark) {
  :root { --bg: #161614; --fg: #eeeae2; --muted: #9b978d; --line: #35332e; --ac: #6fc2a9; }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 17px/1.5 system-ui, sans-serif; }
main { max-width: 34rem; margin: 0 auto; padding: 3rem 16px; }
h1 { font-size: 1.5rem; margin: 0 0 .25rem; }
.sub, #msg, #m { color: var(--muted); }
textarea, select, input[type="text"] { width: 100%; padding: .6rem; font: inherit; color: inherit; background: transparent; border: 1px solid var(--line); border-radius: 8px; }
label { display: block; margin: 1rem 0 .25rem; color: var(--muted); font-size: .9rem; }
button { font: inherit; padding: .7rem 1.4rem; border: 0; border-radius: 999px; background: var(--ac); color: var(--bg); cursor: pointer; margin-top: 1rem; }
button:disabled { opacity: .5; cursor: default; }
#result { margin-top: 1.5rem; display: flex; gap: .5rem; align-items: center; }
#result button { margin-top: 0; }
.center { text-align: center; padding-top: 6rem; }
```

- [ ] **Step 7: Write `public/index.html`**

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
    <label for="file">Or choose a .txt or audio file</label>
    <input id="file" type="file" accept=".txt,text/plain,audio/*">
    <label for="voice">Voice (for text)</label>
    <select id="voice">
      <option value="af_heart">Heart (female)</option>
      <option value="af_bella">Bella (female)</option>
      <option value="bf_emma">Emma (British, female)</option>
      <option value="am_michael">Michael (male)</option>
      <option value="am_onyx">Onyx (deep male)</option>
      <option value="bm_george">George (British, male)</option>
    </select>
    <div id="ts"></div>
    <button id="go" type="submit">Make link</button>
    <p id="msg" role="status"></p>
  </form>
  <div id="result" hidden>
    <input id="link" type="text" readonly>
    <button id="copy" type="button">Copy</button>
  </div>
</main>
<script src="/config.js"></script>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" defer></script>
<script type="module" src="/app.js"></script>
</body>
</html>
```

- [ ] **Step 8: Write `public/app.js`**

```js
import { MAX_AUDIO_SECONDS } from "/limits.js";
import { pickSource } from "/create-logic.js";

const $ = (id) => document.getElementById(id);
const msg = $("msg");
let tsToken = "";
let tsId;

function initTurnstile() {
  if (!window.turnstile) return setTimeout(initTurnstile, 200);
  tsId = turnstile.render("#ts", {
    sitekey: window.TURNSTILE_SITE_KEY,
    callback: (t) => (tsToken = t),
    "expired-callback": () => (tsToken = ""),
  });
}
initTurnstile();

function audioSeconds(file) {
  return new Promise((resolve, reject) => {
    const a = new Audio();
    a.preload = "metadata";
    a.onloadedmetadata = () => { URL.revokeObjectURL(a.src); resolve(a.duration); };
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
  return audio.toBlob();
}

$("f").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("result").hidden = true;
  $("go").disabled = true;
  try {
    const file = $("file").files[0];
    const fileText = file && !file.type.startsWith("audio/") ? await file.text() : undefined;
    const src = pickSource({ typedText: $("text").value, file, fileText });
    if (src.error) throw new Error(src.error);
    if (!tsToken) throw new Error("Please complete the CAPTCHA first.");

    let blob;
    if (src.kind === "audio") {
      const secs = await audioSeconds(src.file);
      if (secs > MAX_AUDIO_SECONDS) throw new Error("Audio is too long (max 2 minutes).");
      blob = src.file;
    } else {
      msg.textContent = "Loading the voice. The first time can take a minute.";
      blob = await synth(src.text, $("voice").value);
    }

    msg.textContent = "Uploading.";
    const fd = new FormData();
    fd.set("audio", blob, "voice.wav");
    fd.set("turnstile", tsToken);
    const res = await fetch("/api/create", { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Something went wrong.");

    $("link").value = data.link;
    $("result").hidden = false;
    msg.textContent = "Link ready. It plays once.";
  } catch (err) {
    msg.textContent = err.message;
  } finally {
    $("go").disabled = false;
    tsToken = "";
    if (window.turnstile) turnstile.reset(tsId);
  }
});

$("copy").addEventListener("click", async () => {
  await navigator.clipboard.writeText($("link").value);
  $("copy").textContent = "Copied";
});
```

- [ ] **Step 9: Write `public/play.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex">
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
b.onclick = async () => {
  b.disabled = true;
  m.textContent = "Loading.";
  try {
    const r = await fetch(location.pathname + "/play", { method: "POST" });
    if (!r.ok) throw new Error(r.status === 410 ? "This voice note has already been played." : "This link is not available.");
    const a = new Audio(URL.createObjectURL(await r.blob()));
    a.onended = () => { m.textContent = "That was it. This link is now closed."; b.hidden = true; };
    await a.play();
    m.textContent = "Playing.";
  } catch (e) {
    b.hidden = true;
    m.textContent = e.message;
  }
};
</script>
</body>
</html>
```

- [ ] **Step 10: Remove the placeholder and run the suite**

Run: `git rm -q --cached public/.gitkeep; rm public/.gitkeep; npm test`
Expected: all green.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: create page, play page and input selection logic

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Worker routes and integration tests

**Files:**
- Modify: `src/worker.js` (full rewrite)
- Test: `test/worker.test.js`

**Interfaces:**
- Consumes: `Clip` (`init`, `status`, `claim`), `RateLimit.hit`, `verifyTurnstile`, `newToken`, `checkAudio`, `MAX_AUDIO_BYTES`, `RATE_LIMIT`, `RATE_WINDOW_MS`, bindings `BUCKET`, `CLIP`, `RATE`, `ASSETS`, secret `TURNSTILE_SECRET`.
- Produces: `handle(request, env, deps?: { verify?: typeof verifyTurnstile }): Promise<Response>`, the default Worker export, and the exported classes `Clip` and `RateLimit`.

- [ ] **Step 1: Write the failing tests `test/worker.test.js`**

```js
import { env } from "cloudflare:workers";
import { describe, it, expect } from "vitest";
import { handle } from "../src/worker.js";
import { MAX_AUDIO_BYTES, RATE_LIMIT } from "../public/limits.js";

const pass = async () => true;
const fail = async () => false;
let n = 0;
const nextIp = () => `10.1.0.${++n}`;

function createReq({ bytes = new Uint8Array([1, 2, 3]), type = "audio/wav", from = nextIp(), withFile = true } = {}) {
  const fd = new FormData();
  if (withFile) fd.set("audio", new File([bytes], "a.wav", { type }));
  fd.set("turnstile", "tok");
  return new Request("http://example.com/api/create", { method: "POST", body: fd, headers: { "CF-Connecting-IP": from } });
}
const make = (opts, verify = pass) => handle(createReq(opts), env, { verify });
const tokenOf = (link) => link.split("/p/")[1];
const post = (link) => handle(new Request(link + "/play", { method: "POST" }), env);

async function newLink(opts) {
  const res = await make(opts);
  expect(res.status).toBe(201);
  return (await res.json()).link;
}

describe("POST /api/create", () => {
  it("stores the audio and returns a link", async () => {
    const link = await newLink();
    expect(link).toMatch(/^http:\/\/example\.com\/p\/[A-Za-z0-9_-]{32}$/);
    expect(await env.BUCKET.get(tokenOf(link))).not.toBeNull();
  });

  it("accepts a type with parameters and stores the clean type", async () => {
    const link = await newLink({ type: "audio/webm;codecs=opus" });
    const obj = await env.BUCKET.get(tokenOf(link));
    expect(obj.httpMetadata.contentType).toBe("audio/webm");
  });

  it("rejects non-audio with 415", async () => {
    expect((await make({ type: "text/html" })).status).toBe(415);
  });

  it("rejects an empty file with 400", async () => {
    expect((await make({ bytes: new Uint8Array(0) })).status).toBe(400);
  });

  it("rejects an oversize file with 413", async () => {
    expect((await make({ bytes: new Uint8Array(MAX_AUDIO_BYTES + 1) })).status).toBe(413);
  });

  it("rejects a missing file field with 400", async () => {
    expect((await make({ withFile: false })).status).toBe(400);
  });

  it("rejects a non-form body with 400", async () => {
    const req = new Request("http://example.com/api/create", {
      method: "POST",
      body: "hello",
      headers: { "Content-Type": "text/plain", "CF-Connecting-IP": nextIp() },
    });
    expect((await handle(req, env, { verify: pass })).status).toBe(400);
  });

  it("rejects when the CAPTCHA fails with 403", async () => {
    expect((await make({}, fail)).status).toBe(403);
  });

  it("refuses GET with 405", async () => {
    const res = await handle(new Request("http://example.com/api/create"), env);
    expect(res.status).toBe(405);
  });

  it("limits one IP to 10 links per hour", async () => {
    const from = nextIp();
    for (let i = 0; i < RATE_LIMIT; i++) expect((await make({ from })).status).toBe(201);
    expect((await make({ from })).status).toBe(429);
    expect((await make({ from: nextIp() })).status).toBe(201);
  });
});

describe("play flow", () => {
  it("does not consume the link when the page is fetched, including HEAD", async () => {
    const link = await newLink();
    for (const method of ["GET", "GET", "HEAD"]) {
      const r = await handle(new Request(link, { method }), env);
      expect(r.status).toBe(200);
    }
    const played = await post(link);
    expect(played.status).toBe(200);
  });

  it("serves the audio once with safe headers, then deletes it", async () => {
    const link = await newLink({ bytes: new Uint8Array([9, 8, 7]) });
    const res = await post(link);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("audio/wav");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex");
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([9, 8, 7]);
    expect(await env.BUCKET.get(tokenOf(link))).toBeNull();
    expect((await post(link)).status).toBe(410);
  });

  it("lets exactly one of 10 simultaneous plays win", async () => {
    const link = await newLink();
    const rs = await Promise.all(Array.from({ length: 10 }, () => post(link)));
    const codes = rs.map((r) => r.status);
    expect(codes.filter((c) => c === 200)).toHaveLength(1);
    expect(codes.filter((c) => c === 410)).toHaveLength(9);
    await Promise.all(rs.map((r) => r.arrayBuffer()));
  });

  it("shows 410 on the page after it was played", async () => {
    const link = await newLink();
    await post(link);
    expect((await handle(new Request(link), env)).status).toBe(410);
  });

  it("shows 404 for a valid-looking token that never existed", async () => {
    const link = "http://example.com/p/" + "a".repeat(32);
    expect((await handle(new Request(link), env)).status).toBe(404);
    expect((await post(link)).status).toBe(404);
  });

  it("shows 404 after the clip expires", async () => {
    const link = await newLink();
    const t = tokenOf(link);
    await env.CLIP.get(env.CLIP.idFromName(t)).expire();
    expect((await handle(new Request(link), env)).status).toBe(404);
    expect(await env.BUCKET.get(t)).toBeNull();
  });

  it("answers 404 or 405 for malformed paths, never 500", async () => {
    const paths = ["/p/short", "/p/" + "a".repeat(33), "/p/" + "a".repeat(32) + "/other", "/p/"];
    for (const p of paths) {
      const r = await handle(new Request("http://example.com" + p), env);
      expect(r.status).toBe(404);
    }
    const wrongMethod = await handle(new Request("http://example.com/p/" + "a".repeat(32) + "/play"), env);
    expect(wrongMethod.status).toBe(405);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/worker.test.js`
Expected: FAIL (`handle` is not exported).

- [ ] **Step 3: Rewrite `src/worker.js`**

```js
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
```

- [ ] **Step 4: Update the smoke test for the new behaviour**

Replace `test/smoke.test.js` with:
```js
import { exports } from "cloudflare:workers";
import { describe, it, expect } from "vitest";

describe("worker boots", () => {
  it("serves the create page", async () => {
    const res = await exports.default.fetch("http://example.com/index.html");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("One-time voice note");
  });
});
```

- [ ] **Step 5: Run to verify everything passes**

Run: `npm test`
Expected: every test file passes. If `env.ASSETS.fetch` of `/play.html` returns 404 in the page tests, check that `public/play.html` exists and `html_handling` is `"none"` in `wrangler.jsonc`. If HEAD handling fails inside `Response`, return the response without a body for HEAD only.

- [ ] **Step 6: Commit**

```bash
git add src/worker.js test/worker.test.js test/smoke.test.js
git commit -m "feat: Worker routes for create, play page and play-once audio

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: README, local run and deploy notes

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

````markdown
# onetime-vn-web

Type text or pick a `.txt` or audio file. Get a link that plays once.
Text becomes speech in your browser (Kokoro). The server only stores the audio and enforces play-once.

## Run locally

```bash
npm install
cp .dev.vars.example .dev.vars   # Turnstile test secret
npm run dev                      # http://localhost:8787
```

The first text-to-speech use downloads a model of about 90 MB.

## Test

```bash
npm test
```

## Deploy (needs a free Cloudflare account)

```bash
npx wrangler login
npx wrangler r2 bucket create onetime-vn-web-audio
npx wrangler secret put TURNSTILE_SECRET     # your Turnstile secret key
# put your Turnstile site key in public/config.js
npm run deploy
```

Turnstile: Cloudflare dashboard, Turnstile, Add widget. Add your `*.workers.dev` hostname (and `localhost` for local runs). Keep the secret key out of git.

## Limits

Text 1,000 characters. Audio 3 MB and 2 minutes (the 2 minute limit is checked in the browser). Types: mp3, wav, ogg, m4a, webm. 10 links per hour per IP. Unplayed links expire after 24 hours.

## Manual test checklist

1. Make a link from typed text. Open it in a private window. Press Play. It plays.
2. Open the same link again. It says it was already played.
3. Make a link from a `.txt` file and from an mp3. Both play once.
4. Paste a link into a chat app and check the preview does not use it up.
5. Try a file over 3 MB, a PDF, and 1,001 characters of text. Each shows a clear message.
6. Open a link on a phone (Safari on iPhone included) and press Play.
7. Make 11 links quickly from one network. The 11th is refused.
````

- [ ] **Step 2: Run the full suite one last time**

Run: `npm test`
Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README with run, test, deploy and manual test checklist

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-review notes

- **Spec coverage:** create page (Task 6), text to speech in the browser (Task 6), upload API with limits, CAPTCHA and rate limit (Tasks 2, 4, 5, 7), play-once with non-consuming page load (Tasks 3, 7), deletion after play and 24 hour expiry (Tasks 3, 7), error messages (Tasks 2, 7), manual checklist (Task 8). The only deviation is the browser-side 2 minute check, stated above.
- **Types and names** match across tasks: `Clip.init/status/claim/expire/expiresAt`, `RateLimit.hit`, `verifyTurnstile`, `newToken/isToken`, `checkAudio/normalizeType`, `pickSource`, `handle`.
- **Not covered by automated tests:** in-browser TTS (kokoro-js from jsDelivr), the Turnstile widget, and iOS Safari autoplay after an async fetch. These are in the owner's manual checklist.
