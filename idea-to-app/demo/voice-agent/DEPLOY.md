# Going live — Stage 4

Everything below the deploy itself is already done: the pre-flight list is clean,
the app has been restructured so it actually works on serverless, and 15 of 15
checks pass. What is left is the one step the kit says belongs to you, because it
is your account and your credentials.

## Pre-flight, as run on 2026-11-03

| Check | Result |
| --- | --- |
| All acceptance checks pass | 15 of 15, about 2 seconds |
| The break-it fixes are still in | Covered by checks 5 and 6, both passing |
| Works on a phone | Check 7: 390×844, no sideways scroll, 64px touch target |
| Nothing secret is in the code | Searched: no key-shaped strings. `.env` is ignored, `.env.example` is empty of values |
| Keys live in the host's settings screen | Nothing needed to run. A voice key is optional and goes in Vercel's Environment Variables screen — you type it |
| Nothing costs money without a yes | No runtime dependencies, no database, no paid service. Vercel Hobby covers this |
| Someone can get their data deleted | Nothing is kept to delete — see the Trust Card |
| The Trust Card matches reality | Updated when the store changed |

**One thing the pre-flight caught, and it matters.** Vercel's functions have no
disk that survives a request. Writing bookings to a file would have deployed an
app that loses them silently — the worst kind of broken, because the demo would
still look fine. The store is now in memory and the Trust Card says so.

## Deploy it — the command line

```
cd idea-to-app/demo/voice-agent
npx vercel login          # opens your browser; you type everything
npx vercel deploy --prod
```

Answer the prompts: scope **rajeshnandakumar-3309's projects**, a new project
(suggested name `daves-plumbing-assistant`), and accept the defaults. The
`vercel.json` here already sets the output directory, so there is nothing to
work out. First deploy takes about a minute.

## Or the dashboard

New Project → import `Raj-intru/context-hub` → **set Root Directory to
`idea-to-app/demo/voice-agent`** → Framework **Other** → Deploy. The root
directory is the only setting that is not a default; miss it and Vercel builds
the whole Context Hub repo instead.

## Then, with the live address open on your phone

1. Run the core flow once: ask the hours, ask something silly, make a booking.
2. Put the address at the top of `project-docs/progress.md` and on the Trust Card.
3. Record the gate in `progress.md`: the date and your own words.

## If you want me to do the deploy instead

I could not, on 2026-11-03: the Vercel connector in this session can read your
teams and projects but returns **403, "You don't have permission to create a
project"**. It can see eight existing projects — all of them real apps — and
deploying into one of those would replace a live site, so I did not try.

Reconnecting Vercel at <https://claude.ai/customize/connectors> with permission
to create projects, then starting a new session, would let an agent finish this.
Whether that is worth it is your call: the kit's own rule 4 says the learner
handles their own credentials, so doing it yourself is the normal path, not the
fallback.

## A note on the voice, once it is live

The deployed app uses the browser's voice, because `public/voice/` is not
committed. To ship the generated audio: run `npm run voice` locally with your
key, drop `public/voice/` out of `.gitignore`, commit the MP3s, and redeploy.
They are static files, so they cost nothing to serve and need no key in
production — which is the point of pre-generating them.
