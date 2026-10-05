import { MAX_AUDIO_BYTES, MAX_AUDIO_SECONDS } from "/limits.js";
import { encodeWav16 } from "/wav.js";
import { pickSource } from "/create-logic.js";

const $ = (id) => document.getElementById(id);
const msg = $("msg");
const go = $("go");
const fileInput = $("file");
const drop = $("drop");
const engineSelect = $("engine");
const voiceSelect = $("voice");

// Voices for the in-browser engine (Kokoro). Server engines come from /api/engines.
const BROWSER_VOICES = [
  { id: "af_heart", label: "Heart (female)" },
  { id: "af_bella", label: "Bella (female)" },
  { id: "bf_emma", label: "Emma (British, female)" },
  { id: "am_michael", label: "Michael (male)" },
  { id: "am_onyx", label: "Onyx (deep male)" },
  { id: "bm_george", label: "George (British, male)" },
];
const ENGINE_NAMES = { piper: "Voice made: on the server (Piper)", kokoro: "Voice made: on the server (Kokoro)" };
let serverVoices = {};

function fillVoices() {
  const voices = engineSelect.value === "browser" ? BROWSER_VOICES : serverVoices[engineSelect.value];
  voiceSelect.replaceChildren(...voices.map((v) => new Option("Voice: " + v.label, v.id)));
}
engineSelect.addEventListener("change", fillVoices);
fillVoices();

// Offer the server engines only if this server has any.
fetch("/api/engines")
  .then((res) => res.json())
  .then((engines) => {
    serverVoices = engines;
    for (const name of Object.keys(engines)) engineSelect.append(new Option(ENGINE_NAMES[name] ?? name, name));
  })
  .catch(() => {});

const CREATE = "Create link";
// Set only when the browser refused to copy automatically: the next tap copies
// this link instead of creating a new one.
let pendingLink = "";
let resetTimer;

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function showCopied() {
  pendingLink = "";
  msg.textContent = "Link copied to your clipboard. It plays once.";
  go.textContent = "Link copied";
  clearTimeout(resetTimer);
  resetTimer = setTimeout(() => (go.textContent = CREATE), 2000);
}

// Changing the input means the old link no longer matches: back to creating.
function backToCreate() {
  if (!pendingLink) return;
  pendingLink = "";
  go.textContent = CREATE;
}
$("text").addEventListener("input", backToCreate);
fileInput.addEventListener("change", backToCreate);

function renderPicked() {
  const file = fileInput.files[0];
  $("picked").hidden = !file;
  $("dropLabel").hidden = Boolean(file);
  $("fileName").textContent = file ? file.name : "";
}

drop.addEventListener("click", (e) => {
  if (e.target.id === "clear") return;
  fileInput.click();
});
drop.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fileInput.click();
  }
});
["dragenter", "dragover"].forEach((type) =>
  drop.addEventListener(type, (e) => {
    e.preventDefault();
    drop.classList.add("over");
  }),
);
["dragleave", "drop"].forEach((type) => drop.addEventListener(type, () => drop.classList.remove("over")));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  if (e.dataTransfer.files.length) {
    fileInput.files = e.dataTransfer.files;
    renderPicked();
  }
});
fileInput.addEventListener("change", renderPicked);
$("clear").addEventListener("click", (e) => {
  e.preventDefault();
  fileInput.value = "";
  renderPicked();
});

function audioSeconds(file) {
  return new Promise((resolve, reject) => {
    const a = new Audio();
    a.preload = "metadata";
    a.onloadedmetadata = () => {
      URL.revokeObjectURL(a.src);
      resolve(a.duration);
    };
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
  return new Blob([encodeWav16(audio.audio, audio.sampling_rate)], { type: "audio/wav" });
}

async function postForLink(url, init) {
  const res = await fetch(url, { method: "POST", ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data.link;
}

// Audio file as-is, or text spoken by Kokoro in this browser, then uploaded.
async function uploadAudio(src) {
  let blob;
  if (src.kind === "audio") {
    const secs = await audioSeconds(src.file);
    if (secs > MAX_AUDIO_SECONDS) throw new Error("Audio is too long (max 2 minutes).");
    blob = src.file;
  } else {
    msg.textContent = "Loading the voice. The first time can take a minute.";
    blob = await synth(src.text, voiceSelect.value);
    if (blob.size > MAX_AUDIO_BYTES) throw new Error("That text makes audio over 3 MB. Please use shorter text.");
  }
  msg.textContent = "Uploading.";
  return postForLink("/api/create", { headers: { "Content-Type": blob.type || "application/octet-stream" }, body: blob });
}

$("f").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (pendingLink) {
    if (await copy(pendingLink)) showCopied();
    else msg.textContent = "Your browser would not copy it. Try again, or use a different browser.";
    return;
  }
  clearTimeout(resetTimer);
  go.textContent = CREATE;
  go.disabled = true;
  try {
    const file = fileInput.files[0];
    const fileText = file && !file.type.startsWith("audio/") ? await file.text() : undefined;
    const src = pickSource({ typedText: $("text").value, file, fileText });
    if (src.error) throw new Error(src.error);

    let link;
    if (src.kind === "text" && engineSelect.value !== "browser") {
      msg.textContent = "Making the voice on the server. This can take a minute.";
      link = await postForLink("/api/speak", {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: src.text, engine: engineSelect.value, voice: voiceSelect.value }),
      });
    } else {
      link = await uploadAudio(src);
    }

    if (await copy(link)) {
      showCopied();
    } else {
      pendingLink = link;
      msg.textContent = "Link ready. Tap Copy link to copy it. It plays once.";
      go.textContent = "Copy link";
    }
  } catch (err) {
    msg.textContent = err.message;
  } finally {
    go.disabled = false;
  }
});
