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
