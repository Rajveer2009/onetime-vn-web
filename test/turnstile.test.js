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
