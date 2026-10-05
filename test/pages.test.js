import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (name) => readFileSync(new URL(`../public/${name}`, import.meta.url), "utf8");

describe("create page", () => {
  const html = read("index.html");
  it("has a styled drop area and a hidden native file input", () => {
    expect(html).toContain('id="drop"');
    expect(html).toMatch(/<input[^>]*id="file"[^>]*hidden/);
  });
  it("never shows the link: one Create link button, no link element or copy button", () => {
    expect(html).toMatch(/<button[^>]*id="go"[^>]*>Create link<\/button>/);
    expect(html).not.toContain('id="link"');
    expect(html).not.toContain('id="copy"');
    expect(html).not.toContain('id="result"');
    expect(html).not.toContain("readonly");
  });
  it("has no separate labels, so every element sits in one evenly spaced stack", () => {
    expect(html).not.toMatch(/<label/);
  });
  it("has no CAPTCHA", () => {
    expect(html.toLowerCase()).not.toContain("turnstile");
    expect(html).not.toContain("config.js");
  });
});

describe("create page script", () => {
  const js = read("app.js");
  it("uploads the audio as a raw body and has no CAPTCHA or form upload", () => {
    expect(js).toContain('"/api/create"');
    expect(js).toContain("Content-Type");
    expect(js.toLowerCase()).not.toContain("turnstile");
    expect(js).not.toContain("FormData");
  });
});

describe("play page", () => {
  const html = read("play.html");
  it("shows no audio controller", () => {
    expect(html).not.toMatch(/\bcontrols\b/);
    expect(html).not.toMatch(/<audio/i);
  });
  it("has a Play button and posts to the play route", () => {
    expect(html).toContain('id="b"');
    expect(html).toContain('"/play"');
  });
});
