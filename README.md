# onetime-vn-web

Type text or pick a `.txt` or audio file. Get a link that plays once.
Text becomes speech in your browser (Kokoro). A small Node server on your Mac keeps the audio in memory, and a free `cloudflared` quick tunnel makes the links public. No account needed.

## Run

```bash
brew install cloudflared      # once, for the public links
npm install                   # once, installs the test runner only
npm start
```

It prints a local address (`http://localhost:8787`) and a public address like `https://some-words.trycloudflare.com`. Open either to make a link. Links look like `https://some-words.trycloudflare.com/<token>`.

Settings:
- `PORT=8800 npm start` to use another port.
- `NO_TUNNEL=1 npm start` to run on this Mac only (no public links).
- `CLOUDFLARED_BIN=/path/to/cloudflared` if the binary is somewhere unusual.

If `cloudflared` is missing or does not start, the server keeps running local-only and says so.

## Things to know

- Links work only while your Mac is awake and `npm start` is running.
- Restarting makes a new public address and loses all stored clips, so old links stop working.
- There is no CAPTCHA. Abuse protection is a limit of 10 links per hour per visitor and at most 100 unplayed clips stored at once.
- The first text-to-speech use downloads a model of about 90 MB.

## Limits

Text 1,000 characters. Audio 3 MB and 2 minutes (the 2 minute limit is checked in the browser). Types: mp3, wav, ogg, m4a, webm. Unplayed links expire after 24 hours; the audio is deleted right after the first play.

## Test

```bash
npm test
```

## Manual test checklist

1. Make a link from typed text. Open it in a private window. Press Play. It plays, with no player controls shown.
2. Open the same link again. It says it was already played.
3. Choose a `.txt` file and an mp3 with the file area, and again by dragging them onto it. Both make a link that plays once. Use "remove" to clear a chosen file.
4. The link appears as clickable text, not in a box. Copy puts it on the clipboard and says "Copied".
5. Paste a link into a chat app and check the preview does not use it up.
6. Try a file over 3 MB, a PDF, and 1,001 characters of text. Each shows a clear message.
7. Open a public link on a phone (Safari on iPhone included) over mobile data and press Play. If autoplay is blocked the button says "Tap to play".
8. Make 11 links quickly. The 11th is refused.
