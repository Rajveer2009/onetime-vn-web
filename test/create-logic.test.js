import { describe, it, expect } from "vitest";
import { pickSource } from "../public/create-logic.js";
import { MAX_TEXT_CHARS } from "../public/limits.js";

const file = (name, type) => ({ name, type });

describe("pickSource", () => {
  it("uses typed text when no file is chosen", () => {
    expect(pickSource({ typedText: "  hello  " })).toEqual({ kind: "text", text: "hello" });
  });
  it("asks for input when everything is empty", () => {
    expect(pickSource({ typedText: "   " })).toEqual({ error: "Type some text or choose a file." });
    expect(pickSource({})).toEqual({ error: "Type some text or choose a file." });
  });
  it("rejects text over the limit", () => {
    const r = pickSource({ typedText: "a".repeat(MAX_TEXT_CHARS + 1) });
    expect(r.error).toMatch(/too long/);
    expect(pickSource({ typedText: "a".repeat(MAX_TEXT_CHARS) }).kind).toBe("text");
  });
  it("prefers a chosen file over typed text", () => {
    const f = file("a.mp3", "audio/mpeg");
    expect(pickSource({ typedText: "ignored", file: f })).toEqual({ kind: "audio", file: f });
  });
  it("reads a .txt file by type or by name", () => {
    expect(pickSource({ file: file("n.txt", "text/plain"), fileText: " hi " })).toEqual({ kind: "text", text: "hi" });
    expect(pickSource({ file: file("n.TXT", ""), fileText: "yo" })).toEqual({ kind: "text", text: "yo" });
  });
  it("rejects an empty or oversize .txt file", () => {
    expect(pickSource({ file: file("n.txt", "text/plain"), fileText: "  " }).error).toBeTruthy();
    expect(pickSource({ file: file("n.txt", "text/plain"), fileText: "a".repeat(MAX_TEXT_CHARS + 1) }).error).toMatch(/too long/);
  });
  it("rejects other file types", () => {
    expect(pickSource({ file: file("a.pdf", "application/pdf") })).toEqual({ error: "Choose a .txt file or an audio file." });
  });
});
