import { MAX_AUDIO_SECONDS } from "/limits.js";
import { pickSource } from "/create-logic.js";

const $ = (id) => document.getElementById(id);
const msg = $("msg");
let tsToken = "";
let tsId;

function initTurnstile() {
  if (!window.turnstile) return setTimeout(initTurnstile, 200);
  tsId = turnstile.render("#ts", {
    sitekey: window.TURNSTILE_SITE_KEY,
    callback: (t) => (tsToken = t),
    "expired-callback": () => (tsToken = ""),
  });
}
initTurnstile();

function audioSeconds(file) {
  return new Promise((resolve, reject) => {
    const a = new Audio();
    a.preload = "metadata";
    a.onloadedmetadata = () => { URL.revokeObjectURL(a.src); resolve(a.duration); };
    a.onerror = () => reject(new Error("Could not read that audio file."));
    a.src = URL.createObjectURL(file);
  });
}

async function synth(text, voice) {
  const { KokoroTTS } = await import("https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js");
  const device = navigator.gpu ? "webgpu" : "wasm";
  const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
    dtype: device === "webgpu" ? "fp32" : "q8",
    device,
  });
  const audio = await tts.generate(text, { voice });
  return audio.toBlob();
}

$("f").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("result").hidden = true;
  $("go").disabled = true;
  try {
    const file = $("file").files[0];
    const fileText = file && !file.type.startsWith("audio/") ? await file.text() : undefined;
    const src = pickSource({ typedText: $("text").value, file, fileText });
    if (src.error) throw new Error(src.error);
    if (!tsToken) throw new Error("Please complete the CAPTCHA first.");

    let blob;
    if (src.kind === "audio") {
      const secs = await audioSeconds(src.file);
      if (secs > MAX_AUDIO_SECONDS) throw new Error("Audio is too long (max 2 minutes).");
      blob = src.file;
    } else {
      msg.textContent = "Loading the voice. The first time can take a minute.";
      blob = await synth(src.text, $("voice").value);
    }

    msg.textContent = "Uploading.";
    const fd = new FormData();
    fd.set("audio", blob, "voice.wav");
    fd.set("turnstile", tsToken);
    const res = await fetch("/api/create", { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Something went wrong.");

    $("link").value = data.link;
    $("result").hidden = false;
    msg.textContent = "Link ready. It plays once.";
  } catch (err) {
    msg.textContent = err.message;
  } finally {
    $("go").disabled = false;
    tsToken = "";
    if (window.turnstile) turnstile.reset(tsId);
  }
});

$("copy").addEventListener("click", async () => {
  await navigator.clipboard.writeText($("link").value);
  $("copy").textContent = "Copied";
});
