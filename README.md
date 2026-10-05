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

## Where the voice is made

The page has a switch for where text becomes speech:

- **In my browser (Kokoro)**: always available. Needs a recent browser; the first use downloads a model of about 90 MB.
- **In my browser (Piper)**: always available. Runs Piper in the page (the `vits-web` library, ONNX Runtime and a Piper voice of about 63 MB, all downloaded the first time and then kept by the browser). Tested in Firefox.
- **On the server (Piper)** and **On the server (Kokoro)**: shown only if the server has them installed. Good for slow phones. One clip is made at a time, with a short queue, so a busy server answers "busy".

To install the server voices, make one Python environment and point the server at it:

```bash
uv venv ~/tts-venv --python 3.12
uv pip install --python ~/tts-venv/bin/python piper-tts kokoro-onnx soundfile

export TTS_VENV=~/tts-venv                       # has bin/piper and bin/python
export TTS_PIPER_MODELS=~/piper-voices           # <voice>.onnx and <voice>.onnx.json files
export TTS_KOKORO_MODELS=~/kokoro-voices         # kokoro-v1.0.onnx and voices-v1.0.bin
npm start
```

Piper voices come from https://huggingface.co/rhasspy/piper-voices and the Kokoro files from the kokoro-onnx releases. The server lists whatever voices it finds. With none of these set, only the browser voice is offered.

## Things to know

- Links work only while your Mac is awake and `npm start` is running.
- Restarting makes a new public address and loses all stored clips, so old links stop working.
- There is no CAPTCHA. Abuse protection is a limit of 10 links per hour per visitor and at most 100 unplayed clips stored at once.

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
9. If the server has voices installed: switch the voice menu to a server engine, make a link from text, and check it plays. Try a long text (1,000 characters) and check the message if it takes long.
