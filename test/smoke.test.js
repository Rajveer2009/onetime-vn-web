import { exports } from "cloudflare:workers";
import { describe, it, expect } from "vitest";

describe("worker boots", () => {
  it("serves the create page", async () => {
    const res = await exports.default.fetch("http://example.com/index.html");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("One-time voice note");
  });
});
