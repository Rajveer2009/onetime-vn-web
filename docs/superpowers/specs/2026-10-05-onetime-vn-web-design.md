# onetime-vn-web: design

> **Status: superseded in part.** This was the first design, which hosted the site on Cloudflare Workers, R2 and Turnstile. That hosting was replaced by a Node server with a quick tunnel; see [the Node + quick-tunnel design](2026-10-05-onetime-vn-web-node-design.md). The product behaviour here (one-time play, limits, link previews not burning the link) still applies. The Workers, R2, Durable Objects and Turnstile parts do not exist in the code any more.

Date: 2026-10-05

## Purpose

A minimal public website. A visitor enters text, a text file or an audio file and gets a link that plays the voice note exactly once. Anyone on the internet can create links. It replaces the local-only `onetime-vn` command (which needs the owner's Mac running) with an always-on hosted version, written as new code.

## Decisions (agreed with the owner)

| Question | Decision |
|---|---|
| Who creates links | Anyone on the internet, no accounts |
| Where text becomes speech | In the visitor's browser, with Kokoro (kokoro-js). The server never runs TTS |
| Hosting and storage | Cloudflare Workers + R2 + one Durable Object per clip |
| Tech | Plain JavaScript, no framework, minimal design |
| Source control | git, repo at `~/claude/onetime-vn-web` |
| Manual browser testing | Done by the owner. Automated tests are written and run by the implementer |

## Components

1. **Create page (`/`).** A text box, a file picker (`.txt` or audio), a voice dropdown and a "Make link" button, plus a Turnstile widget.
   - Text or `.txt` file: kokoro-js converts it to audio in the browser.
   - Audio file: used as it is.
   - The browser uploads the audio to `POST /api/create` and shows the returned link with a copy button.
2. **Worker.**
   - `POST /api/create`: validates the Turnstile token, the rate limit, the file size and the type, stores the audio in R2 under a random key, creates the Durable Object for the clip, returns the play link.
   - `GET /p/<token>`: the play page. Shows a Play button. Does not consume the link, so link previews from chat apps cannot burn it.
   - `POST /p/<token>/play`: asks the clip's Durable Object to mark the clip played. Only the first request is served the audio. Later requests get 410.
3. **Clip Durable Object.** One per clip. Holds `unplayed | played` and an expiry alarm. Its single-threaded execution makes the play-once check exact, so two simultaneous plays cannot both succeed.
4. **R2 bucket.** Stores the audio under the random key. The object is deleted right after it is served, or by the 24 hour alarm if never played.

## Data flow

visitor's browser → Worker → R2 and the clip Durable Object. On play: browser → Worker → Durable Object (claim) → R2 (read, then delete) → browser.

## Limits

- Text and `.txt` file: at most 1,000 characters.
- Audio: at most 3 MB and 2 minutes. Accepted types: mp3, wav, ogg, m4a, webm.
- Rate limit: 10 links per hour per IP address.
- Turnstile (free CAPTCHA) required on creation.
- Expiry: 24 hours if never played. Deleted right after the first play.
- Tokens: at least 128 bits of randomness, so links cannot be guessed. Responses carry `Cache-Control: no-store` and `X-Robots-Tag: noindex`.

## Errors

Plain messages for: too big, wrong file type, rate limit reached, CAPTCHA failed, link already played (410), link not found or expired (404).

## Abuse and non-goals

- Anyone can create links without an account, and content is not moderated. The limits, the CAPTCHA and the 24 hour expiry keep misuse small.
- Out of scope for version 1: accounts, a report-content flow, content moderation, link analytics, custom expiry, passwords on links.
- Browser support: kokoro-js needs a recent browser (WebGPU or WASM). The first visit downloads a model of about 90 MB. If the browser cannot run it, the page says so and the visitor can still upload an audio file.

## Testing

- Automated (implementer): the main test sends two plays at once and checks that exactly one receives the audio. Further tests cover size and type limits, the rate limit, expiry through the alarm, and that opening the play page does not consume the link.
- Manual (owner): run the full flow in a real browser, create a link from text and from an audio file, play it once and confirm the second open is refused.

## Open items for the plan

- Cloudflare account and a Turnstile site key are needed before deploying. Local development works without them using Turnstile's test keys.
- Exact kokoro-js model and quantisation choice, to be settled during implementation.
