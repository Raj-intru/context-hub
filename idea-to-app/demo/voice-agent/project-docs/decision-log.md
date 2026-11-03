# Decision log

### 2026-11-03 — no language model in the brain

- **The choice:** the assistant matches keywords and falls through to "I'll take
  a message". No model decides what to say.
- **The options:** a small language model would handle more phrasings.
- **Why:** check 2 says it must never invent an answer. That is a promise you can
  only keep if the thing cannot invent one. A model would make check 2 something
  you hope for rather than something you test.
- **Changes:** none to the spec. The seam is `classify()` in `src/brain.js` if a
  learner later decides the trade-off is worth it.

### 2026-11-03 — the browser listens, a paid service speaks

- **The choice:** speech recognition from the browser (free, no key). Speaking
  from Cartesia or another provider, **pre-generated to files**.
- **The options:** both halves paid, or both halves free.
- **Why:** the audience judges the voice, not the recognition. Pre-generating the
  fixed lines costs a fraction of a cent and plays from disk, so there is no
  network call and no key needed on stage. With no key at all the browser voice
  still works, so a demo cannot fail on this.
- **Changes:** added `VOICE_PROVIDER` to the setup, and `npm run voice`.

### 2026-11-03 — the phone number is read back grouped, not as digits

- **The choice:** "0412 345 678", not "zero four one two three four five…".
- **Why:** a caller cannot check a number they cannot follow. This came out of
  saying the readback out loud once.
