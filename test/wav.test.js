import { describe, it, expect } from "vitest";
import { encodeWav16 } from "../public/wav.js";

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
