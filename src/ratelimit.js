import { DurableObject } from "cloudflare:workers";

export class RateLimit extends DurableObject {
  async hit(limit, windowMs) {
    const now = Date.now();
    let w = await this.ctx.storage.get("w");
    if (!w || now >= w.start + windowMs) {
      w = { start: now, count: 0 };
      await this.ctx.storage.setAlarm(now + windowMs);
    }
    if (w.count >= limit) {
      await this.ctx.storage.put("w", w);
      return { allowed: false };
    }
    w.count += 1;
    await this.ctx.storage.put("w", w);
    return { allowed: true, remaining: limit - w.count };
  }

  async alarm() {
    await this.ctx.storage.deleteAll();
  }
}
