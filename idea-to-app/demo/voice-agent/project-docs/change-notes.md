# Change notes

### 2026-11-03 — added the running-costs dashboard

- **Why:** an SME running a voice agent is spending money per call and has no way
  to see it. Standard on SME builds from now on.
- **How to check it:** take a booking on the assistant, then open
  `/dashboard.html`. You should see the booking counted, what it cost, and how
  long you waited for a reply — and nothing you said.
- **Tests:** 11 added, 26 of 26 passing.
- **Found by rendering it:** the latency bars did not draw at all — they were
  `<span>`s, which ignore width and height. Four numbers on screen said one thing
  and the picture said nothing. A validator cannot catch that; opening the page
  can.

### 2026-11-03 — made it work on serverless hosting

- **Why:** the Stage 4 pre-flight caught that Vercel has no disk that survives a
  request, so writing bookings to a file would have lost them without saying so.
- **How to check it:** make a booking; it appears on the list. Reload the page
  after a few minutes and it is gone — which is now the stated behaviour, not a
  bug.
- **Tests:** none added; 15 of 15 still passing against the new structure.

### 2026-11-03 — read the phone number back the way an Australian says it

- **Why:** reading ten digits in pairs is unfollowable out loud.
- **How to check it:** book something and listen to the last line.
- **Tests:** 1 updated, 15 of 15 passing.

### 2026-11-03 — step 3: take a booking

- **Why:** must-have 3.
- **How to check it:** say "book me in for Tuesday", give a name and a number,
  watch it appear under *Bookings taken*.
- **Tests:** 4 added, 14 of 14 passing.

### 2026-11-03 — step 2: answer the three questions, and refuse to guess

- **Why:** must-haves 2, and acceptance check 2.
- **How to check it:** ask the hours, then ask about roof tiling.
- **Tests:** 3 added, 10 of 10 passing.

### 2026-11-03 — step 1: listen and show the transcript

- **Why:** must-have 1.
- **How to check it:** hold Talk and say anything; it appears under *You said*.
  Refuse the microphone and a typed box appears instead.
- **Tests:** 7 added, 7 of 7 passing.
