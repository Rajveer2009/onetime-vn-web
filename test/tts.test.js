import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTts, discoverEngines, synthesizeWith } from "../server/tts.js";

const tmp = () => mkdtempSync(join(tmpdir(), "ovw-test-"));
const touch = (path) => writeFileSync(path, "x");
const script = (path, body) => {
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
};

// A fake "piper" that copies the text it is given into the output file.
const FAKE_PIPER = `while [ $# -gt 0 ]; do case "$1" in -f) out="$2";; -m) model="$2";; esac; shift; done; { printf '%s|' "$model"; cat; } > "$out"`;

describe("discoverEngines", () => {
  it("finds nothing without TTS_VENV", () => {
    expect(discoverEngines({})).toEqual({});
  });

  it("lists piper voices that have both the model and its json", () => {
    const venv = tmp();
    const models = tmp();
    mkdirSync(join(venv, "bin"));
    touch(join(venv, "bin", "piper"));
    touch(join(models, "en_US-amy-medium.onnx"));
    touch(join(models, "en_US-amy-medium.onnx.json"));
    touch(join(models, "en_GB-alba-medium.onnx")); // no json: ignored
    touch(join(models, "weird name.onnx"));
    touch(join(models, "weird name.onnx.json"));
    const e = discoverEngines({ TTS_VENV: venv, TTS_PIPER_MODELS: models });
    expect(Object.keys(e)).toEqual(["piper"]);
    expect(e.piper.voices).toEqual([{ id: "en_US-amy-medium", label: "Amy (US, medium)" }]);
  });

  it("offers kokoro only when python and both model files exist", () => {
    const venv = tmp();
    const models = tmp();
    mkdirSync(join(venv, "bin"));
    touch(join(venv, "bin", "python"));
    touch(join(models, "kokoro-v1.0.onnx"));
    expect(discoverEngines({ TTS_VENV: venv, TTS_KOKORO_MODELS: models }).kokoro).toBeUndefined();
    touch(join(models, "voices-v1.0.bin"));
    const e = discoverEngines({ TTS_VENV: venv, TTS_KOKORO_MODELS: models });
    expect(e.kokoro.voices.map((v) => v.id)).toContain("af_heart");
  });
});

describe("synthesizeWith", () => {
  it("passes the text on stdin and the model and output paths as arguments", async () => {
    const venv = tmp();
    const models = tmp();
    mkdirSync(join(venv, "bin"));
    script(join(venv, "bin", "piper"), FAKE_PIPER);
    const engines = { piper: { bin: join(venv, "bin", "piper"), models, voices: [{ id: "v1", label: "V1" }] } };
    const wav = await synthesizeWith(engines, { engine: "piper", voice: "v1", text: "hello there" }, 5000);
    expect(wav.toString()).toBe(`${join(models, "v1.onnx")}|hello there`);
  });

  it("fails when the engine exits with an error", async () => {
    const venv = tmp();
    mkdirSync(join(venv, "bin"));
    script(join(venv, "bin", "piper"), "echo broken >&2; exit 3");
    const engines = { piper: { bin: join(venv, "bin", "piper"), models: tmp(), voices: [] } };
    await expect(synthesizeWith(engines, { engine: "piper", voice: "v", text: "x" }, 5000)).rejects.toThrow(/exit 3/);
  });

  it("kills an engine that takes too long", async () => {
    const venv = tmp();
    mkdirSync(join(venv, "bin"));
    script(join(venv, "bin", "piper"), "sleep 5");
    const engines = { piper: { bin: join(venv, "bin", "piper"), models: tmp(), voices: [] } };
    await expect(synthesizeWith(engines, { engine: "piper", voice: "v", text: "x" }, 200)).rejects.toThrow(/timeout/);
  });
});

describe("createTts", () => {
  const engines = { piper: { voices: [{ id: "amy", label: "Amy" }] } };

  it("reports the voices per engine and validates choices", () => {
    const tts = createTts({ engines, synthesize: async () => Buffer.from("w") });
    expect(tts.engines()).toEqual({ piper: [{ id: "amy", label: "Amy" }] });
    expect(tts.isValid("piper", "amy")).toBe(true);
    expect(tts.isValid("piper", "nope")).toBe(false);
    expect(tts.isValid("kokoro", "amy")).toBe(false);
    expect(tts.isValid("__proto__", "amy")).toBe(false);
  });

  it("runs one job at a time, in order, and refuses beyond the queue", async () => {
    const order = [];
    const gates = [];
    const synthesize = (req) =>
      new Promise((resolve) => {
        order.push("start " + req.text);
        gates.push(() => resolve(Buffer.from(req.text)));
      });
    const tts = createTts({ engines, synthesize, maxQueue: 1 });
    const a = tts.speak({ engine: "piper", voice: "amy", text: "a" });
    const b = tts.speak({ engine: "piper", voice: "amy", text: "b" });
    await expect(tts.speak({ engine: "piper", voice: "amy", text: "c" })).rejects.toMatchObject({ busy: true });
    expect(order).toEqual(["start a"]);
    gates[0]();
    expect((await a).toString()).toBe("a");
    await new Promise((r) => setTimeout(r, 0));
    expect(order).toEqual(["start a", "start b"]);
    gates[1]();
    expect((await b).toString()).toBe("b");
  });

  it("releases the slot when a job fails", async () => {
    let n = 0;
    const synthesize = async () => {
      if (n++ === 0) throw new Error("boom");
      return Buffer.from("ok");
    };
    const tts = createTts({ engines, synthesize, maxQueue: 0 });
    await expect(tts.speak({ engine: "piper", voice: "amy", text: "x" })).rejects.toThrow("boom");
    expect((await tts.speak({ engine: "piper", voice: "amy", text: "x" })).toString()).toBe("ok");
  });
});
