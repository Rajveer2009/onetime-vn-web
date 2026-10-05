import { describe, it, expect, afterEach } from "vitest";
import { start } from "../server/index.js";
import { encodeWav16 } from "../public/wav.js";

const quiet = () => {};
let running;
afterEach(async () => {
  await running?.close();
  running = undefined;
});

const tone = () => new Uint8Array(encodeWav16(Float32Array.from({ length: 2400 }, (_, i) => Math.sin(i / 10) * 0.5), 24000));
const baseOf = (app) => `http://127.0.0.1:${app.port}`;
const createOn = (base) => fetch(base + "/api/create", { method: "POST", headers: { "content-type": "audio/wav" }, body: tone() });

describe("start", () => {
  it("runs the whole flow end to end without a tunnel", async () => {
    running = await start({ port: 0, tunnel: false, log: quiet });
    expect(running.publicUrl).toBeNull();
    const base = baseOf(running);

    expect((await fetch(base + "/")).status).toBe(200);

    const bytes = tone();
    const res = await fetch(base + "/api/create", { method: "POST", headers: { "content-type": "audio/wav" }, body: bytes });
    expect(res.status).toBe(201);
    const { link } = await res.json();
    expect(link.startsWith(base + "/")).toBe(true);

    expect((await fetch(link)).status).toBe(200);
    const played = await fetch(link + "/play", { method: "POST" });
    expect(played.status).toBe(200);
    expect(new Uint8Array(await played.arrayBuffer())).toEqual(bytes);
    expect((await fetch(link + "/play", { method: "POST" })).status).toBe(410);
    expect((await fetch(link)).status).toBe(410);
  });

  it("builds links on the tunnel address when the tunnel comes up", async () => {
    const code = "console.error('https://fake-words-here.trycloudflare.com'); setInterval(()=>{},1000)";
    running = await start({ port: 0, tunnel: true, tunnelOptions: { bin: process.execPath, args: ["-e", code], timeoutMs: 5000 }, log: quiet });
    expect(running.publicUrl).toBe("https://fake-words-here.trycloudflare.com");
    const { link } = await (await createOn(baseOf(running))).json();
    expect(link).toMatch(/^https:\/\/fake-words-here\.trycloudflare\.com\/[A-Za-z0-9_-]{32}$/);
  });

  it("keeps running local-only when cloudflared is missing", async () => {
    running = await start({ port: 0, tunnel: true, tunnelOptions: { bin: "definitely-not-installed-xyz", timeoutMs: 5000 }, log: quiet });
    expect(running.publicUrl).toBeNull();
    const res = await createOn(baseOf(running));
    expect(res.status).toBe(201);
    expect((await res.json()).link).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]{32}$/);
  });
});
