import { DurableObject } from "cloudflare:workers";
import { TTL_MS } from "../public/limits.js";

export class Clip extends DurableObject {
  async init(token, contentType) {
    await this.ctx.storage.put({ token, contentType, status: "unplayed" });
    await this.ctx.storage.setAlarm(Date.now() + TTL_MS);
  }

  async status() {
    return (await this.ctx.storage.get("status")) ?? "missing";
  }

  async claim() {
    return this.ctx.blockConcurrencyWhile(async () => {
      const status = (await this.ctx.storage.get("status")) ?? "missing";
      if (status !== "unplayed") return { ok: false, reason: status };
      await this.ctx.storage.put("status", "played");
      return { ok: true, contentType: await this.ctx.storage.get("contentType") };
    });
  }

  async expiresAt() {
    return this.ctx.storage.getAlarm();
  }

  async expire() {
    const token = await this.ctx.storage.get("token");
    if (token) await this.env.BUCKET.delete(token);
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  async alarm() {
    await this.expire();
  }
}
