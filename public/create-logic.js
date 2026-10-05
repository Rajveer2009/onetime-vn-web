import { MAX_TEXT_CHARS } from "./limits.js";

function fromText(raw) {
  const text = (raw ?? "").trim();
  if (!text) return { error: "Type some text or choose a file." };
  if (text.length > MAX_TEXT_CHARS) return { error: `Text is too long (max ${MAX_TEXT_CHARS} characters).` };
  return { kind: "text", text };
}

export function pickSource({ typedText, file, fileText }) {
  if (!file) return fromText(typedText);
  if (file.type.startsWith("audio/")) return { kind: "audio", file };
  if (file.type === "text/plain" || file.name.toLowerCase().endsWith(".txt")) return fromText(fileText);
  return { error: "Choose a .txt file or an audio file." };
}
