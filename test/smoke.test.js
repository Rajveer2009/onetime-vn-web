import { exports } from "cloudflare:workers";
import { describe, it, expect } from "vitest";

describe("worker boots", () => {
  it("answers 404 for an unknown path", async () => {
    const res = await exports.default.fetch("http://example.com/api/nope");
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not found");
  });
});
