# Dave's Plumbing — after-hours voice assistant

The app the Idea to App demo builds. Hold a button, ask a question, hear an
answer, leave a booking. Built by following the kit's own stages; the trail is in
`project-docs/`.

## Run it

```
npm start            # http://localhost:3000 — no keys, no accounts, no install
```

Chrome or Edge. The browser does the listening, so Safari and Firefox are weak
here, and the page falls back to a typed box wherever speech is unavailable.

## Test it

```
npm install                        # once — Playwright, for the browser tests
npx playwright install chromium    # once — the browser it drives
npm test                           # 15 checks, about 2 seconds
```

`npm run test:brain` needs nothing installed at all: the brain is a plain module
with no browser in it, which is the point.

## Give it a real voice

Optional. Without this it uses the browser's built-in voice — fine for a
rehearsal, flat in front of an audience.

```
cp .env.example .env               # then type your key into .env yourself
npm run voice                      # generates public/voice/*.mp3, prints the cost
npm start
```

About 900 characters of fixed lines, so one generation costs a fraction of a
cent on any provider. The files are cached, so the demo plays from disk: no
network call, no latency, no key needed while you are presenting.

**Which provider.** `Cartesia` by default — cheapest commercial entry and the
lowest latency, which is what matters when this moves onto a real phone line.
`ElevenLabs` and `OpenAI` work by changing `VOICE_PROVIDER`. Prices move; check
the provider's own page before budgeting.

Lines containing a caller's name or number cannot be pre-generated. The first
time one is spoken it is synthesised and cached, so **rehearsing warms the
cache** — use the same fake name in the rehearsal as in the demo and even the
read-back plays from disk.

## How it is put together

| File | What it does |
| --- | --- |
| `src/brain.js` | Text in, reply out. No audio, no browser, no network, no model |
| `src/business.js` | The three answers — the only file a learner edits to make it theirs |
| `src/tts.js` | One function per voice provider |
| `public/app.js` | The microphone half: speech in, audio out, nothing decided here |
| `server.js` | Serves the page, keeps the bookings, synthesises on a cache miss |
| `test/brain.test.js` | Checks 1-4 and the ways people get it wrong. No browser |
| `test/ui.test.mjs` | Checks 5-7 in a real browser, with the speech engine stubbed |

**The decision worth copying:** the brain is separate from the microphone. That
is what makes "we have tests" true rather than decorative — the conversation is
tested as a pure function, and one browser test feeds it a fake transcript.

**No language model decides what it says.** Acceptance check 2 promises it never
invents an answer, and that is only a promise you can keep if it cannot. See
`project-docs/decision-log.md`.

## What it is not

Not a phone line — that needs telephony, and it is version 2. Not a general
assistant. It never tries to recognise who you are from your voice, which is a
deliberate line in the spec, not an oversight: see `../sme-security.md`.
