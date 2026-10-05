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
