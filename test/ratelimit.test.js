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
