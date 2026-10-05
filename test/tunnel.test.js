import { describe, it, expect } from "vitest";
import { parseTunnelUrl, findCloudflared, startTunnel } from "../server/tunnel.js";

const node = process.execPath;
const script = (code) => ["-e", code];

describe("parseTunnelUrl", () => {
  it("finds the trycloudflare address in a log line", () => {
    const line = "2026-10-05T10:00:00Z INF |  https://quiet-river-demo-words.trycloudflare.com  |";
    expect(parseTunnelUrl(line)).toBe("https://quiet-river-demo-words.trycloudflare.com");
  });
  it("returns null when there is none", () => {
    expect(parseTunnelUrl("INF Requesting new quick Tunnel")).toBeNull();
    expect(parseTunnelUrl("https://example.com")).toBeNull();
  });
});

describe("findCloudflared", () => {
  it("prefers CLOUDFLARED_BIN", () => {
    expect(findCloudflared({ CLOUDFLARED_BIN: "/x/cf" }, () => true)).toBe("/x/cf");
  });
  it("uses the Homebrew path when it exists", () => {
    expect(findCloudflared({}, () => true)).toBe("/opt/homebrew/opt/cloudflared/bin/cloudflared");
  });
  it("falls back to PATH lookup", () => {
    expect(findCloudflared({}, () => false)).toBe("cloudflared");
  });
});

describe("startTunnel", () => {
  it("resolves with the address and can be stopped", async () => {
    const code = "console.error('INF https://fake-words-here.trycloudflare.com ok'); setInterval(()=>{},1000)";
    const t = await startTunnel(1234, { bin: node, args: script(code), timeoutMs: 5000 });
    expect(t.url).toBe("https://fake-words-here.trycloudflare.com");
    t.stop();
  });

  it("finds an address split across two chunks", async () => {
    const code = "process.stderr.write('https://split-wo'); setTimeout(()=>process.stderr.write('rds.trycloudflare.com\\n'),50); setInterval(()=>{},1000)";
    const t = await startTunnel(1234, { bin: node, args: script(code), timeoutMs: 5000 });
    expect(t.url).toBe("https://split-words.trycloudflare.com");
    t.stop();
  });

  it("resolves null when the binary is missing", async () => {
    const t = await startTunnel(1234, { bin: "definitely-not-installed-xyz", timeoutMs: 5000 });
    expect(t.url).toBeNull();
    t.stop();
  });

  it("resolves null when the process exits without an address", async () => {
    const t = await startTunnel(1234, { bin: node, args: script("process.exit(1)"), timeoutMs: 5000 });
    expect(t.url).toBeNull();
  });

  it("resolves null on timeout and still stops the process", async () => {
    const t = await startTunnel(1234, { bin: node, args: script("setInterval(()=>{},1000)"), timeoutMs: 200 });
    expect(t.url).toBeNull();
    t.stop();
  });
});
