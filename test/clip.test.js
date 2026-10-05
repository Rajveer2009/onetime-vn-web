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
