import { describe, it, expect, afterEach } from "vitest";
import { MAX_AUDIO_BYTES, MAX_TEXT_CHARS, RATE_LIMIT } from "../public/limits.js";
import { startTestServer, nextIp } from "./helpers.js";

const VOICES = { piper: [{ id: "amy", label: "Amy" }], kokoro: [{ id: "af_heart", label: "Heart" }] };
const WAV = Buffer.from("RIFF-fake-wav");

function fakeTts(overrides = {}) {
  const calls = [];
  return {
    calls,
    engines: () => VOICES,
    isValid: (engine, voice) => Object.hasOwn(VOICES, engine) && VOICES[engine].some((v) => v.id === voice),
    speak: async (req) => {
      calls.push(req);
      return WAV;
    },
    ...overrides,
  };
}

let ctx;
afterEach(() => ctx?.close());

const speak = (body, ip = nextIp(), raw = false) =>
  fetch(ctx.base + "/api/speak", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": ip },
    body: raw ? body : JSON.stringify(body),
  });
const good = { text: "hello there", engine: "piper", voice: "amy" };

describe("GET /api/engines", () => {
  it("lists the server voices", async () => {
    ctx = await startTestServer({ tts: fakeTts() });
    const res = await fetch(ctx.base + "/api/engines");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(VOICES);
  });

  it("is empty when the server has no voice engine", async () => {
    ctx = await startTestServer();
    expect(await (await fetch(ctx.base + "/api/engines")).json()).toEqual({});
  });

  it("refuses POST with 405", async () => {
    ctx = await startTestServer({ tts: fakeTts() });
    expect((await fetch(ctx.base + "/api/engines", { method: "POST" })).status).toBe(405);
  });
});

describe("POST /api/speak", () => {
  it("makes the audio on the server and returns a playable link", async () => {
    const tts = fakeTts();
    ctx = await startTestServer({ tts });
    const res = await speak(good);
    expect(res.status).toBe(201);
    expect(tts.calls).toEqual([good]);
    const { link } = await res.json();
    expect(link).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]{32}$/);
    const played = await fetch(link + "/play", { method: "POST" });
    expect(played.status).toBe(200);
    expect(played.headers.get("content-type")).toBe("audio/wav");
    expect(Buffer.from(await played.arrayBuffer())).toEqual(WAV);
    expect((await fetch(link + "/play", { method: "POST" })).status).toBe(410);
  });

  it("trims the text before synthesising", async () => {
    const tts = fakeTts();
    ctx = await startTestServer({ tts });
    await speak({ ...good, text: "  spaced  " });
    expect(tts.calls[0].text).toBe("spaced");
  });

  it("rejects an unknown engine or voice with 400 and never calls the engine", async () => {
    const tts = fakeTts();
    ctx = await startTestServer({ tts });
    for (const bad of [{ ...good, engine: "nope" }, { ...good, voice: "../../etc/passwd" }, { ...good, engine: "__proto__" }, { text: "x" }]) {
      expect((await speak(bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect(tts.calls).toEqual([]);
  });

  it("rejects empty, missing, non-string and oversize text with 400", async () => {
    ctx = await startTestServer({ tts: fakeTts() });
    for (const text of ["", "   ", undefined, 42, "a".repeat(MAX_TEXT_CHARS + 1)]) {
      const res = await speak({ ...good, text });
      expect(res.status, String(text).slice(0, 10)).toBe(400);
    }
    expect((await speak({ ...good, text: "a".repeat(MAX_TEXT_CHARS) })).status).toBe(201);
  });

  it("rejects a body that is not JSON with 400", async () => {
    ctx = await startTestServer({ tts: fakeTts() });
    expect((await speak("not json", nextIp(), true)).status).toBe(400);
  });

  it("rejects a huge body with 413 before parsing it", async () => {
    ctx = await startTestServer({ tts: fakeTts() });
    expect((await speak({ ...good, text: "a".repeat(100_000) })).status).toBe(413);
  });

  it("answers 503 when the engine is busy", async () => {
    ctx = await startTestServer({ tts: fakeTts({ speak: async () => { throw Object.assign(new Error("busy"), { busy: true }); } }) });
    const res = await speak(good);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/busy/i);
  });

  it("answers 502 when the engine fails", async () => {
    ctx = await startTestServer({ tts: fakeTts({ speak: async () => { throw new Error("exit 1"); } }) });
    const res = await speak(good);
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/try again/i);
  });

  it("answers 413 when the spoken audio would be over 3 MB", async () => {
    ctx = await startTestServer({ tts: fakeTts({ speak: async () => Buffer.alloc(MAX_AUDIO_BYTES + 1) }) });
    const res = await speak(good);
    expect(res.status).toBe(413);
    expect((await res.json()).error).toMatch(/shorter text/i);
  });

  it("answers 400 when the server has no voice engine at all", async () => {
    ctx = await startTestServer();
    expect((await speak(good)).status).toBe(400);
  });

  it("shares the 10-per-hour limit and the clip cap with uploads", async () => {
    ctx = await startTestServer({ tts: fakeTts(), storeOptions: { maxUnplayed: 100 } });
    const ip = nextIp();
    for (let i = 0; i < RATE_LIMIT; i++) expect((await speak(good, ip)).status).toBe(201);
    expect((await speak(good, ip)).status).toBe(429);
    await ctx.close();
    ctx = await startTestServer({ tts: fakeTts(), storeOptions: { maxUnplayed: 1 } });
    expect((await speak(good)).status).toBe(201);
    expect((await speak(good)).status).toBe(503);
  });

  it("refuses GET with 405", async () => {
    ctx = await startTestServer({ tts: fakeTts() });
    expect((await fetch(ctx.base + "/api/speak")).status).toBe(405);
  });
});
