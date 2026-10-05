export const MAX_TEXT_CHARS = 1000;
export const MAX_AUDIO_BYTES = 3 * 1024 * 1024;
export const MAX_AUDIO_SECONDS = 120;
export const RATE_LIMIT = 10;
export const RATE_WINDOW_MS = 60 * 60 * 1000;
export const TTL_MS = 24 * 60 * 60 * 1000;

export const ALLOWED_AUDIO_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/ogg",
  "audio/mp4",
  "audio/x-m4a",
  "audio/webm",
];

export function normalizeType(type) {
  return String(type ?? "").split(";")[0].trim().toLowerCase();
}

export function checkAudio({ size, type }) {
  const t = normalizeType(type);
  if (!size) return { ok: false, status: 400, error: "The audio file is empty." };
  if (size > MAX_AUDIO_BYTES) return { ok: false, status: 413, error: "That file is too big (max 3 MB)." };
  if (!ALLOWED_AUDIO_TYPES.includes(t)) {
    return { ok: false, status: 415, error: "Unsupported audio type. Use mp3, wav, ogg, m4a or webm." };
  }
  return { ok: true, type: t };
}
