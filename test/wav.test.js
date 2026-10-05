import { describe, it, expect } from "vitest";
import { encodeWav16, toWav16 } from "../public/wav.js";

const view = (buf) => new DataView(buf);
const str = (v, o, n) => String.fromCharCode(...Array.from({ length: n }, (_, i) => v.getUint8(o + i)));

describe("encodeWav16", () => {
  it("writes a 16-bit mono PCM header and 2 bytes per sample", () => {
    const buf = encodeWav16(new Float32Array(100), 24000);
    const v = view(buf);
    expect(buf.byteLength).toBe(44 + 200);
    expect(str(v, 0, 4)).toBe("RIFF");
    expect(str(v, 8, 4)).toBe("WAVE");
    expect(v.getUint16(20, true)).toBe(1);      // PCM
    expect(v.getUint16(22, true)).toBe(1);      // mono
    expect(v.getUint32(24, true)).toBe(24000);  // sample rate
    expect(v.getUint16(34, true)).toBe(16);     // bits
    expect(v.getUint32(40, true)).toBe(200);    // data bytes
  });
  it("scales samples to 16-bit and clips out-of-range values", () => {
    const v = view(encodeWav16(new Float32Array([0, 1, -1, 2, -2, 0.5]), 24000));
    const at = (i) => v.getInt16(44 + i * 2, true);
    expect([at(0), at(1), at(2), at(3), at(4)]).toEqual([0, 32767, -32768, 32767, -32768]);
    expect(at(5)).toBe(16384);
  });
  it("keeps a 1,000-character read (about 60 s at 24 kHz) under 3 MB", () => {
    expect(encodeWav16(new Float32Array(24000 * 60), 24000).byteLength).toBeLessThan(3 * 1024 * 1024);
  });
});

// A WAV with 32-bit float samples, the way browser TTS libraries often write them.
function floatWav(samples, rate, channels = 1) {
  const buf = new ArrayBuffer(44 + samples.length * 4);
  const v = new DataView(buf);
  const text = (o, t) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  text(0, "RIFF"); v.setUint32(4, 36 + samples.length * 4, true); text(8, "WAVE"); text(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 3, true); v.setUint16(22, channels, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 4 * channels, true); v.setUint16(32, 4 * channels, true);
  v.setUint16(34, 32, true); text(36, "data"); v.setUint32(40, samples.length * 4, true);
  samples.forEach((x, i) => v.setFloat32(44 + i * 4, x, true));
  return buf;
}

describe("toWav16", () => {
  it("turns a 32-bit float WAV into a half-size 16-bit WAV with the same rate", () => {
    const out = toWav16(floatWav(Float32Array.from([0, 0.5, -0.5, 1]), 22050));
    const v = view(out);
    expect(out.byteLength).toBe(44 + 8);
    expect(v.getUint16(20, true)).toBe(1);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(24, true)).toBe(22050);
    expect([0, 1, 2, 3].map((i) => v.getInt16(44 + i * 2, true))).toEqual([0, 16384, -16384, 32767]);
  });

  it("returns a 16-bit mono WAV unchanged", () => {
    const wav = encodeWav16(new Float32Array(10), 22050);
    expect(toWav16(wav)).toBe(wav);
  });

  it("finds the data chunk even when other chunks come first", () => {
    const base = new Uint8Array(floatWav(Float32Array.from([0.25]), 16000));
    const list = new Uint8Array([76, 73, 83, 84, 4, 0, 0, 0, 1, 2, 3, 4]); // 'LIST' chunk, 4 bytes
    const joined = new Uint8Array(base.length + list.length);
    joined.set(base.subarray(0, 36)); joined.set(list, 36); joined.set(base.subarray(36), 36 + list.length);
    expect(view(toWav16(joined.buffer)).getInt16(44, true)).toBe(8192);
  });

  it("mixes stereo down to mono", () => {
    const out = toWav16(floatWav(Float32Array.from([1, 0, 0.5, 0.5]), 22050, 2));
    const v = view(out);
    expect(v.getUint16(22, true)).toBe(1);
    expect([v.getInt16(44, true), v.getInt16(46, true)]).toEqual([16384, 16384]);
  });

  it("rejects things that are not WAV files", () => {
    expect(() => toWav16(new ArrayBuffer(100))).toThrow(/WAV/);
  });
});
