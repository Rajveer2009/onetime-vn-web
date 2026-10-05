# onetime-vn-web

Type some text, or pick a `.txt` or audio file, and get a link that plays a voice note **exactly once**. After the first play the audio is deleted and the link is dead.

It is a small Node server with no runtime dependencies. A free [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) quick tunnel makes the links public, with no account and no domain.

```
 you ──► create page ──► /api/create or /api/speak ──► clip kept in memory
                                                            │
 friend ◄── https://<words>.trycloudflare.com/<token> ◄─────┘
           (press Play once, then the clip is deleted)
```

## Features

- **One-time play.** The first press of Play gets the audio. Everyone after that is told it was already played. Even 10 people pressing Play at the same instant produce exactly one winner.
- **Link previews don't burn it.** Opening the page (a chat app's preview, a browser prefetch) does not use the link up. Only the Play button does.
- **Three inputs.** Typed text, a `.txt` file, or an audio file (mp3, wav, ogg, m4a, webm).
- **Four ways to make the voice.** In the visitor's browser or on the server, with Kokoro or Piper (see below).
- **Minimal page.** One column, one Create link button that copies the link to the clipboard.
- **Expires on its own.** Unplayed clips are deleted after 24 hours.

## Quick start

```bash
brew install cloudflared      # once, for public links (optional)
npm install                   # once, installs the test runner only
npm start
```

It prints a local address (`http://localhost:8787`) and, if the tunnel starts, a public one like `https://some-words.trycloudflare.com`. Open either to make a link. Links look like `https://some-words.trycloudflare.com/<token>`.

| Setting | Effect |
|---|---|
| `PORT=8800` | Use another port (default 8787). |
| `NO_TUNNEL=1` | Run on this machine only, with no public links. |
| `CLOUDFLARED_BIN=/path` | Use a `cloudflared` binary in an unusual place. |

If `cloudflared` is missing or does not start, the server keeps running local-only and says so.

## Where the voice is made

The page has a **Voice made** menu. Pick where text becomes speech, then a voice.

| Option | Always available? | Notes |
|---|---|---|
| In my browser (Kokoro) | yes | [kokoro-js](https://github.com/hexgrad/kokoro). 6 voices. First use downloads about 90 MB. |
| In my browser (Piper) | yes | [vits-web](https://github.com/diffusionstudio/vits-web) with ONNX Runtime. 14 English voices. Each downloads about 63 MB the first time and is then kept by the browser. Needs a recent browser. |
| On the server (Piper) | only if installed | Any Piper voices you put in a folder. |
| On the server (Kokoro) | only if installed | 6 voices. Heavier, so slower on a small machine. |

Server voices run one at a time with a short queue. When it is full, the server answers "busy". To enable them:

```bash
uv venv ~/tts-venv --python 3.12
uv pip install --python ~/tts-venv/bin/python piper-tts kokoro-onnx soundfile

export TTS_VENV=~/tts-venv                       # has bin/piper and bin/python
export TTS_PIPER_MODELS=~/piper-voices           # <voice>.onnx and <voice>.onnx.json files
export TTS_KOKORO_MODELS=~/kokoro-voices         # kokoro-v1.0.onnx and voices-v1.0.bin
npm start
```

Piper voices come from [rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices). The Kokoro files come from the [kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx) releases. The server lists whatever it finds, and the page only shows the server options that exist.

## Limits and abuse protection

- Text and `.txt` files: up to 1,000 characters.
- Audio: up to 3 MB and 2 minutes (the 2 minute check is made in the browser, the 3 MB cap on the server). Types: mp3, wav, ogg, m4a, webm.
- 10 links per hour per visitor.
- At most 100 unplayed clips stored at once (in memory), then the server answers "busy".
- Unplayed links expire after 24 hours. The audio is freed right after the first play.
- Uploads over the limit are cut off while they are being read, not buffered.

There is **no CAPTCHA and no accounts**. Anyone who can reach the page can make links, and nothing is moderated. If you expose this publicly, expect to rely on the rate limit and the clip cap.

## HTTP API

| Route | What it does |
|---|---|
| `GET /` | The create page. |
| `POST /api/create` | Body is the raw audio, `Content-Type` is its type. Returns `201 { "link": ... }`. |
| `POST /api/speak` | JSON `{ "text", "engine", "voice" }`. The server makes the audio. Returns `201 { "link": ... }`. |
| `GET /api/engines` | The server voices that are installed, by engine. |
| `GET /<token>` | The play page. Does not use the link up. |
| `POST /<token>/play` | Returns the audio once, then `410`. |

Tokens are 32 URL-safe characters (192 bits of randomness). Responses are sent with `Cache-Control: no-store`, `X-Robots-Tag: noindex`, `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`. The server only listens on `127.0.0.1`; the tunnel is the way in.

## Things to know

- Links work only while this server and the machine stay on and online.
- A quick tunnel address changes every time the server or tunnel restarts, and it dies for good if the connection drops for a while (for example when a laptop sleeps). Old links then stop working. A stable address needs a domain and a named tunnel.
- Clips live in memory, so restarting the server loses all of them.

## Tests

```bash
npm test
```

About 100 tests run in under a second. They cover the clip store, the rate limiter, the HTTP routes (including 10 simultaneous plays, oversize and chunked uploads, odd paths), the tunnel starter, the server voice engine plumbing, and the WAV helpers. The in-browser voices and the page's look are checked by hand (see below).

## Project layout

```
server/   Node server: app.js (routes), store.js (clips), ratelimit.js, tunnel.js,
          tts.js + kokoro_speak.py (server voices), index.js / main.js (start-up)
public/   The pages: index.html, app.js (create page), play.html, style.css,
          limits.js (shared limits), wav.js, create-logic.js
test/     Vitest tests
docs/     Design specs and plans (including the earlier Cloudflare Workers design
          that this version replaced)
```

## Manual test checklist

1. Make a link from typed text. Open it in a private window. Press Play. It plays, with no player controls shown.
2. Open the same link again. It says it was already played.
3. Choose a `.txt` file and an mp3, with the file area and by dragging. Both make a link that plays once. "remove" clears a chosen file.
4. Create link copies the link to the clipboard and the button briefly says "Link copied". If the browser blocks copying, the button becomes "Copy link".
5. Paste a link into a chat app and check the preview does not use it up.
6. Try a file over 3 MB, a PDF, and 1,001 characters of text. Each shows a clear message.
7. Open a public link on a phone (Safari on iPhone included) and press Play. If autoplay is blocked the button says "Tap to play".
8. Make 11 links quickly. The 11th is refused.
9. Try each voice option, including a long text, in a real browser.
