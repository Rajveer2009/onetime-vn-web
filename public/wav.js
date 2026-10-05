// Float samples (-1..1) to a 16-bit mono PCM WAV. kokoro-js writes 32-bit float,
// which is twice the size and would push a long read past the 3 MB limit.
export function encodeWav16(samples, sampleRate) {
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(buffer);
  const text = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  text(0, "RIFF");
  v.setUint32(4, 36 + dataBytes, true);
  text(8, "WAVE");
  text(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, "data");
  v.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? Math.round(s * 32768) : Math.round(s * 32767), true);
  }
  return buffer;
}

// Any browser-made WAV (16-bit PCM or 32-bit float, mono or stereo) to the
// smaller 16-bit mono WAV we upload. A 16-bit mono file is returned as is.
export function toWav16(buffer) {
  const v = new DataView(buffer);
  const tag = (o, t) => [...t].every((c, i) => o + i < v.byteLength && v.getUint8(o + i) === c.charCodeAt(0));
  if (!tag(0, "RIFF") || !tag(8, "WAVE")) throw new Error("That is not a WAV file.");

  let format;
  let channels;
  let rate;
  let bits;
  let data;
  for (let o = 12; o + 8 <= v.byteLength; ) {
    const size = v.getUint32(o + 4, true);
    if (tag(o, "fmt ")) {
      format = v.getUint16(o + 8, true);
      channels = v.getUint16(o + 10, true);
      rate = v.getUint32(o + 12, true);
      bits = v.getUint16(o + 22, true);
    } else if (tag(o, "data")) {
      data = { start: o + 8, length: Math.min(size, v.byteLength - o - 8) };
      break;
    }
    o += 8 + size + (size % 2);
  }
  if (!data || !format) throw new Error("That WAV file is damaged.");
  if (format === 1 && bits === 16 && channels === 1) return buffer;

  const bytes = bits / 8;
  const frames = Math.floor(data.length / (bytes * channels));
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      const at = data.start + (i * channels + c) * bytes;
      sum += format === 3 ? v.getFloat32(at, true) : v.getInt16(at, true) / 32768;
    }
    mono[i] = sum / channels;
  }
  return encodeWav16(mono, rate);
}
