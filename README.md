# onetime-vn-web

Type text or pick a `.txt` or audio file. Get a link that plays once.
Text becomes speech in your browser (Kokoro). The server only stores the audio and enforces play-once.

## Run locally

```bash
npm install
cp .dev.vars.example .dev.vars   # Turnstile test secret
npm run dev                      # http://localhost:8787
```

The first text-to-speech use downloads a model of about 90 MB.

## Test

```bash
npm test
```

## Deploy (needs a free Cloudflare account)

```bash
npx wrangler login
npx wrangler r2 bucket create onetime-vn-web-audio
npx wrangler secret put TURNSTILE_SECRET     # your Turnstile secret key
# put your Turnstile site key in public/config.js
npm run deploy
```

Turnstile: Cloudflare dashboard, Turnstile, Add widget. Add your `*.workers.dev` hostname (and `localhost` for local runs). Keep the secret key out of git.

## Limits

Text 1,000 characters. Audio 3 MB and 2 minutes (the 2 minute limit is checked in the browser). Types: mp3, wav, ogg, m4a, webm. 10 links per hour per IP. Unplayed links expire after 24 hours.

## Manual test checklist

1. Make a link from typed text. Open it in a private window. Press Play. It plays.
2. Open the same link again. It says it was already played.
3. Make a link from a `.txt` file and from an mp3. Both play once.
4. Paste a link into a chat app and check the preview does not use it up.
5. Try a file over 3 MB, a PDF, and 1,001 characters of text. Each shows a clear message.
6. Open a link on a phone (Safari on iPhone included) and press Play.
7. Make 11 links quickly from one network. The 11th is refused.
