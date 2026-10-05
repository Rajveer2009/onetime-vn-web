import { RATE_LIMIT, RATE_WINDOW_MS } from "../public/limits.js";

export function createLimiter({ limit = RATE_LIMIT, windowMs = RATE_WINDOW_MS, now = Date.now } = {}) {
  const windows = new Map();

  return {
    hit(key) {
      const t = now();
      let w = windows.get(key);
      if (!w || t >= w.start + windowMs) {
        w = { start: t, count: 0 };
        windows.set(key, w);
      }
      if (w.count >= limit) return { allowed: false };
      w.count += 1;
      return { allowed: true, remaining: limit - w.count };
    },

    prune() {
      const t = now();
      for (const [key, w] of windows) if (t >= w.start + windowMs) windows.delete(key);
    },

    get size() {
      return windows.size;
    },
  };
}
