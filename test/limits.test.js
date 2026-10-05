import { describe, it, expect } from "vitest";
import { MAX_AUDIO_BYTES, normalizeType, checkAudio } from "../public/limits.js";

describe("normalizeType", () => {
  it("drops parameters and lowercases", () => {
    expect(normalizeType("Audio/WebM;codecs=opus")).toBe("audio/webm");
  });
  it("handles missing types", () => {
    expect(normalizeType(undefined)).toBe("");
    expect(normalizeType("")).toBe("");
  });
});

describe("checkAudio", () => {
  it("accepts a normal wav", () => {
    expect(checkAudio({ size: 1000, type: "audio/wav" })).toEqual({ ok: true, type: "audio/wav" });
  });
  it("accepts types with parameters and the odd mp3 name", () => {
    expect(checkAudio({ size: 10, type: "audio/webm;codecs=opus" })).toEqual({ ok: true, type: "audio/webm" });
    expect(checkAudio({ size: 10, type: "audio/mp3" }).ok).toBe(true);
  });
  it("accepts exactly the size cap and rejects one byte more", () => {
    expect(checkAudio({ size: MAX_AUDIO_BYTES, type: "audio/wav" }).ok).toBe(true);
    const r = checkAudio({ size: MAX_AUDIO_BYTES + 1, type: "audio/wav" });
    expect(r).toMatchObject({ ok: false, status: 413 });
  });
  it("rejects an empty file with 400", () => {
    expect(checkAudio({ size: 0, type: "audio/wav" })).toMatchObject({ ok: false, status: 400 });
  });
  it("rejects non-audio and missing types with 415", () => {
    expect(checkAudio({ size: 10, type: "text/html" })).toMatchObject({ ok: false, status: 415 });
    expect(checkAudio({ size: 10, type: "" })).toMatchObject({ ok: false, status: 415 });
  });
});
