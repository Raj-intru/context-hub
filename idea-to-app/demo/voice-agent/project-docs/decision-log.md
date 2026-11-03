# Decision log

### 2026-11-03 — a cost and performance dashboard, by default

- **The choice:** every SME build ships with a dashboard, and the headline is cost
  per booking rather than total spend.
- **The options:** no dashboard; or spend figures only; or wait until someone asks.
- **Why:** five of the six cost lines in a voice agent are usage-based, so a bad
  week is a bill. "$4.12 this month" means nothing to a sole trader; "1.4 cents a
  booking against a $90 call-out" is a decision. And because the brain cannot
  invent an answer, the rate at which it says "I'll take a message" is a real
  quality number rather than an estimate — worth showing precisely because almost
  no AI product can show it.
- **Changes:** the kit's Trust Card template gained a *What it costs to run*
  section, the acceptance-checks template gained two rows, Stage 2 now builds the
  metrics in with the first feature, and Stage 4's pre-flight checks the
  dashboard works and is behind a login.

### 2026-11-03 — the dashboard counts events and never content

- **The choice:** the event log holds an action, a duration, a character count
  and a cached flag. Nothing else, by construction.
- **Why:** it is Lyra's "stats, not chats" rule, and it is what makes the
  dashboard safe to leave on a screen in the shop. A test asserts the exact set of
  keys and fails if a name or number ever reaches it.
- **Changes:** none to the spec; the Trust Card now says the dashboard holds
  nothing anybody said.

### 2026-11-03 — bookings are held in memory, not written down

- **The choice:** the server keeps bookings in memory for the length of the demo
  and never writes them anywhere.
- **The options:** a file (what it did before), or a hosted database.
- **Why:** two reasons, and the second is the better one. Vercel's functions have
  no disk that survives a request, so the file would have failed silently. And a
  public demo link that permanently keeps every passer-by's name and phone number
  is a privacy liability nobody asked for — the SME security notes warn about
  exactly this. A demo should not be a database of strangers.
- **Changes:** `spec.md` data section still holds; the Trust Card now says
  nothing is written down. A real business swaps `src/store.js` and nothing else.

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
