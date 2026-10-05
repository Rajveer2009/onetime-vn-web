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
