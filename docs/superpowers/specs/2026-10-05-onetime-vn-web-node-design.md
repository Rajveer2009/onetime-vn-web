# onetime-vn-web: Node server + quick-tunnel redesign

Date: 2026-10-05. Supersedes the hosting parts of `2026-10-05-onetime-vn-web-design.md` (Cloudflare Workers, R2, Durable Objects, Turnstile). Everything not mentioned here stays as in that spec.

## Purpose

Remove every Cloudflare account dependency. The site becomes a plain Node server on the owner's Mac, made public by a temporary `cloudflared` quick tunnel, the same mechanism the `onetime-vn` command uses. Links look like `https://<random-words>.trycloudflare.com/<token>`. Also: nicer file input, the link shown as text (no text box), no audio controller on the play page.

## Decisions (agreed with the owner)

| Question | Decision |
|---|---|
| Hosting | Node server on the owner's Mac, exposed by a `cloudflared` quick tunnel. No Cloudflare account, Workers, R2 or Turnstile |
| Link shape | `<public base>/<token>`, same as `onetime-vn` links |
| CAPTCHA | None (Turnstile is a Cloudflare service). Abuse protection is rate limiting and a clip cap |
| Text to speech | Unchanged: Kokoro in the visitor's browser |
| Dependencies | No runtime dependencies. Vitest stays as a dev dependency |
| Manual testing | By the owner. Automated tests by the implementer |
| Branch | `node-rewrite`, merged to `main` when done |

## Server (`server/`, plain Node, started with `npm start`)

- `server/index.js`: starts the HTTP server (port from `PORT`, default 8787, bound to 127.0.0.1), then starts the tunnel unless `NO_TUNNEL=1`, and prints the local address and the public address.
- `server/tunnel.js`: spawns `cloudflared tunnel --url http://127.0.0.1:<port> --no-autoupdate` (binary from `CLOUDFLARED_BIN`, else `cloudflared` on `PATH`, else `/opt/homebrew/opt/cloudflared/bin/cloudflared`). Reads the `https://*.trycloudflare.com` address from its output. If no address appears within 30 seconds, or cloudflared is missing, prints a warning and keeps running local-only. Kills the tunnel when the server exits. It does not restart the tunnel, because a new address would break existing links.
- `server/app.js`: `createApp({ store, limiter, getPublicBase })` returns the request handler. Routes:
  - `GET /` and `GET /<name>` for `index.html`, `style.css`, `app.js`, `create-logic.js`, `limits.js`, `wav.js` from `public/` (a fixed list, no directory traversal).
  - `POST /api/create`: raw audio body, type in `Content-Type`. Returns `201 { link }`.
  - `GET` and `HEAD /<token>`: the play page. Does not consume the link.
  - `POST /<token>/play`: serves the audio once.
  - Anything else: 404. Wrong method on a known route: 405.
- `server/store.js`: in-memory clips. `add(token, bytes, type)`, `status(token)` returning `unplayed | played | missing`, `claim(token)` returning `{ ok, bytes, type }` or `{ ok: false, reason }`, and expiry timers. Node is single-threaded, so the claim is atomic. Playing frees the bytes immediately; the small record stays until the 24 hour expiry so a played link answers 410, then 404.
- `server/ratelimit.js`: fixed one-hour window, 10 creates per client. Client key is the `Cf-Connecting-Ip` header (set by cloudflared), else the socket address. Old windows are pruned.
- `public/limits.js` keeps `checkAudio`, `normalizeType` and the constants. `src/token.js` moves to `server/token.js`.

## Limits and rules (unchanged unless noted)

- Audio at most 3 MB; types mp3, wav, ogg, m4a, webm; 2 minute limit is browser-side. The server stops reading the body as soon as it passes 3 MB and answers 413.
- Text and `.txt` at most 1,000 characters.
- 10 links per hour per client.
- **New:** at most 100 unplayed clips stored at once; beyond that `POST /api/create` answers `503 "The server is busy. Try again later."`.
- Expiry 24 hours if never played. Audio freed right after the first play.
- Tokens: 192 bits (`newToken`, 32 URL-safe characters). Static file names are never 32 characters long, so they cannot collide with a token.
- Responses carry `Cache-Control: no-store`, `X-Robots-Tag: noindex`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`.
- The link uses the tunnel address when one exists, otherwise the address the request arrived on.

## Create page changes

- **File input:** the browser's default file box is hidden. A dashed drop area with a "Choose a file" button (click or drop). The chosen name shows beside it with a "remove" link.
- **Link result:** shown as plain clickable text with a **Copy** button that changes to "Copied". No text box.
- **CAPTCHA:** removed (no Turnstile script, no `config.js`).
- **Upload:** `fetch('/api/create', { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob })`.
- Unchanged: text box, voice dropdown, "Make link" button, status line, 16-bit WAV encoding, `create-logic.js`.

## Play page changes

- No audio controller. Only a large **Play** button and a status line.
- The audio is fetched on Play and kept in memory. If the browser blocks autoplay, the button becomes **Tap to play** and plays the audio already held, without asking the server again.
- When it ends: "That was it. This link is now closed."

## Errors

Plain messages as before (too big, wrong type, empty, rate limit, already played 410, not found or expired 404) plus the 503 above. No CAPTCHA message.

## Removed

`wrangler.jsonc`, `src/worker.js`, `src/clip.js`, `src/ratelimit.js`, `src/turnstile.js`, `public/config.js`, `.dev.vars.example`, the Cloudflare vitest plugin, `wrangler`, and their tests. `.dev.vars` and `.wrangler/` entries leave `.gitignore`.

## Trade-offs the owner accepted

- Links work only while the Mac is awake and `npm start` is running. A server restart loses all clips, and a new tunnel address breaks old links.
- No CAPTCHA; anonymous creation with rate limiting only; content is not moderated.
- Non-goals unchanged from the first spec.

## Testing

- Automated: store (add, claim once, 10 simultaneous claims, expiry), rate limiter (limit, separate clients, window reset), app routes over a real server on port 0 (create, size cutoff while streaming, types and parameters, empty body, prefetch GET/HEAD not consuming, one winner among simultaneous plays, bad paths and methods, static whitelist and traversal attempts, clip cap 503), tunnel address parsing with a fake process, and an end-to-end run with a real mp3.
- Manual (owner): look of both pages, drag-and-drop, Kokoro voice in the browser, iPhone playback, a real tunnel link opened from another device.

## README

Rewritten for `npm start`, the optional `NO_TUNNEL=1` and `PORT` settings, the cloudflared requirement, and the manual checklist.
