import { describe, it, expect } from "vitest";
import { newToken, isToken } from "../server/token.js";

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
