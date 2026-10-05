import { TTL_MS } from "../public/limits.js";

export const MAX_UNPLAYED = 100;

export function createStore({ ttlMs = TTL_MS, maxUnplayed = MAX_UNPLAYED } = {}) {
  const clips = new Map();
  let unplayed = 0;

  function drop(token) {
    const clip = clips.get(token);
    if (!clip) return;
    clearTimeout(clip.timer);
    if (clip.status === "unplayed") unplayed--;
    clips.delete(token);
  }

  return {
    isFull: () => unplayed >= maxUnplayed,

    add(token, bytes, type) {
      if (unplayed >= maxUnplayed) return false;
      const timer = setTimeout(() => drop(token), ttlMs);
      timer.unref?.();
      clips.set(token, { bytes, type, status: "unplayed", timer });
      unplayed++;
      return true;
    },

    status: (token) => clips.get(token)?.status ?? "missing",

    claim(token) {
      const clip = clips.get(token);
      if (!clip) return { ok: false, reason: "missing" };
      if (clip.status !== "unplayed") return { ok: false, reason: "played" };
      clip.status = "played";
      unplayed--;
      const { bytes, type } = clip;
      clip.bytes = null;
      return { ok: true, bytes, type };
    },

    expire: drop,

    get size() {
      return clips.size;
    },
  };
}
