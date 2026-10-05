import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const KOKORO_SCRIPT = fileURLToPath(new URL("./kokoro_speak.py", import.meta.url));
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

export const KOKORO_VOICES = [
  { id: "af_heart", label: "Heart (female)" },
  { id: "af_bella", label: "Bella (female)" },
  { id: "bf_emma", label: "Emma (British, female)" },
  { id: "am_michael", label: "Michael (male)" },
  { id: "am_onyx", label: "Onyx (deep male)" },
  { id: "bm_george", label: "George (British, male)" },
];

// "en_US-amy-medium" -> "Amy (US, medium)"
function piperLabel(id) {
  const [lang, name, quality] = id.split("-");
  const region = lang?.split("_")[1];
  const title = (name ?? id).replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase());
  return region && quality ? `${title} (${region}, ${quality})` : title;
}

// Which server voice engines are installed, from environment variables:
//   TTS_VENV            folder with bin/piper and bin/python
//   TTS_PIPER_MODELS    folder of <voice>.onnx + <voice>.onnx.json
//   TTS_KOKORO_MODELS   folder with kokoro-v1.0.onnx and voices-v1.0.bin
export function discoverEngines(env = process.env) {
  const engines = {};
  const venv = env.TTS_VENV;
  if (!venv) return engines;

  const piperBin = join(venv, "bin", "piper");
  const piperModels = env.TTS_PIPER_MODELS;
  if (piperModels && existsSync(piperBin) && existsSync(piperModels)) {
    const voices = readdirSync(piperModels)
      .filter((f) => f.endsWith(".onnx") && existsSync(join(piperModels, f + ".json")))
      .map((f) => f.slice(0, -".onnx".length))
      .filter((id) => SAFE_ID.test(id))
      .sort()
      .map((id) => ({ id, label: piperLabel(id) }));
    if (voices.length) engines.piper = { voices, bin: piperBin, models: piperModels };
  }

  const python = join(venv, "bin", "python");
  const kokoroModels = env.TTS_KOKORO_MODELS;
  if (
    kokoroModels &&
    existsSync(python) &&
    existsSync(join(kokoroModels, "kokoro-v1.0.onnx")) &&
    existsSync(join(kokoroModels, "voices-v1.0.bin"))
  ) {
    engines.kokoro = { voices: KOKORO_VOICES, python, models: kokoroModels };
  }
  return engines;
}

function run(command, args, input, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("timeout"));
    }, timeoutMs);
    child.stderr.on("data", (d) => (stderr = (stderr + d).slice(-2000)));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`exit ${code}: ${stderr.slice(-300)}`));
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

// Runs one engine and returns the WAV bytes. Callers must already have checked
// that engine and voice are on the lists from discoverEngines().
export async function synthesizeWith(engines, { engine, voice, text }, timeoutMs = 120000) {
  const cfg = engines[engine];
  const dir = await mkdtemp(join(tmpdir(), "ovw-tts-"));
  const out = join(dir, "out.wav");
  try {
    if (engine === "piper") {
      await run(cfg.bin, ["-m", join(cfg.models, voice + ".onnx"), "-f", out, "--sentence-silence", "0.3"], text, timeoutMs);
    } else {
      await run(cfg.python, [KOKORO_SCRIPT, voice, out, cfg.models], text, timeoutMs);
    }
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// One synthesis at a time (a small server), a short queue, then "busy".
export function createTts({ engines = discoverEngines(), synthesize = (req) => synthesizeWith(engines, req), maxQueue = 2 } = {}) {
  let running = false;
  const waiting = [];

  return {
    engines: () => Object.fromEntries(Object.entries(engines).map(([name, cfg]) => [name, cfg.voices])),

    isValid: (engine, voice) =>
      Object.hasOwn(engines, engine) && engines[engine].voices.some((v) => v.id === voice),

    speak(req) {
      return new Promise((resolve, reject) => {
        if (running && waiting.length >= maxQueue) return reject(Object.assign(new Error("busy"), { busy: true }));
        const job = () => {
          running = true;
          synthesize(req)
            .then(resolve, reject)
            .finally(() => {
              running = false;
              waiting.shift()?.();
            });
        };
        if (running) waiting.push(job);
        else job();
      });
    },
  };
}
