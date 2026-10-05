import { MAX_AUDIO_BYTES, MAX_AUDIO_SECONDS } from "/limits.js";
import { encodeWav16 } from "/wav.js";
import { pickSource } from "/create-logic.js";

const $ = (id) => document.getElementById(id);
const msg = $("msg");
const go = $("go");
const fileInput = $("file");
const drop = $("drop");

// "create": button makes a new link. "copy": the browser refused to copy
// automatically, so the next tap copies the link we already have.
let mode = "create";
let lastLink = "";
let resetTimer;

function setButton(label, nextMode) {
  go.textContent = label;
  mode = nextMode;
}

function resetButtonSoon() {
  clearTimeout(resetTimer);
  resetTimer = setTimeout(() => setButton("Create link", "create"), 2000);
}

// Changing the input means the old link no longer matches: back to creating.
function backToCreate() {
  if (mode === "copy") setButton("Create link", "create");
}
$("text").addEventListener("input", backToCreate);
fileInput.addEventListener("change", backToCreate);

async function copyLink() {
  try {
    await navigator.clipboard.writeText(lastLink);
    return true;
  } catch {
    return false;
  }
}

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

$("f").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (mode === "copy") {
    if (await copyLink()) {
      msg.textContent = "Link copied to your clipboard. It plays once.";
      setButton("Link copied", "create");
      resetButtonSoon();
    } else {
      msg.textContent = "Your browser would not copy it. Try again, or use a different browser.";
    }
    return;
  }
  clearTimeout(resetTimer);
  go.disabled = true;
  try {
    const file = fileInput.files[0];
    const fileText = file && !file.type.startsWith("audio/") ? await file.text() : undefined;
    const src = pickSource({ typedText: $("text").value, file, fileText });
    if (src.error) throw new Error(src.error);

    let blob;
    if (src.kind === "audio") {
      const secs = await audioSeconds(src.file);
      if (secs > MAX_AUDIO_SECONDS) throw new Error("Audio is too long (max 2 minutes).");
      blob = src.file;
    } else {
      msg.textContent = "Loading the voice. The first time can take a minute.";
      blob = await synth(src.text, $("voice").value);
      if (blob.size > MAX_AUDIO_BYTES) throw new Error("That text makes audio over 3 MB. Please use shorter text.");
    }

    msg.textContent = "Uploading.";
    const res = await fetch("/api/create", {
      method: "POST",
      headers: { "Content-Type": blob.type || "application/octet-stream" },
      body: blob,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Something went wrong.");

    lastLink = data.link;
    if (await copyLink()) {
      msg.textContent = "Link copied to your clipboard. It plays once.";
      setButton("Link copied", "create");
      resetButtonSoon();
    } else {
      msg.textContent = "Link ready. Tap Copy link to copy it. It plays once.";
      setButton("Copy link", "copy");
    }
  } catch (err) {
    msg.textContent = err.message;
  } finally {
    go.disabled = false;
  }
});
