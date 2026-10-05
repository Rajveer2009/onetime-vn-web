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

describe("static pages", () => {
  it("serves the create page at /", async () => {
    const res = await handle(new Request("http://example.com/"), env);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("One-time voice note");
  });
});
