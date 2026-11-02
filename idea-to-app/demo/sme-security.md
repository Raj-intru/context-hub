# Scaling it to an SME — building it for real, and keeping it secure

**This is engineering guidance, not legal advice.** It follows the house style set
by Lyra's `docs/COMPLIANCE.md`: say what is actually enforced, say what is not,
and never put a compliance claim in front of a customer without a qualified
reviewer. Regulatory detail here was checked in November 2026 against reporting
of varying quality — confirm anything load-bearing against the OAIC and the
Attorney-General's Department before you rely on it.

---

## 1. What changes when it stops being a demo

The demo app is honest about being a demo. Four things change on the way to a
business running it on real calls, and an SME should hear all four before they
start, not after.

| Demo | Real |
| --- | --- |
| Browser speech engine, no keys, free | A telephony leg and a hosted speech model — accounts, keys, and a per-minute cost |
| One made-up business | Real customers, whose name, number and voice you now hold |
| Preview link | A public number anyone can ring, including at 3am, including badly |
| "Seven checks pass" | Seven checks pass *and* someone is accountable when they stop passing |

The method does not change. The spec, the gates, the checks and the Trust Card
are identical. That is the argument for using it: when the plumbing changes, the
trail stays valid.

## 2. The production voice stack

Keep the brain separate from the microphone — the decision from
`voice-agent-brief.md` — and you can replace the plumbing without touching the
logic or re-doing the tests.

| Layer | Demo | Real | Why |
| --- | --- | --- | --- |
| Call | Hold a button in a browser | A phone number with a media stream to your app | Customers ring; they do not open links |
| Listening | Browser speech recognition | A hosted speech-to-text model | Accents, trade words, background noise, a saw running |
| Brain | Pure function, fully tested | **Unchanged** | This is the point |
| Speaking | Browser speech synthesis | A hosted text-to-speech voice | Sounds like a business, not a satnav |
| Memory | In the page | A database row per call | Bookings must survive a reload |

This session has Twilio's developer skills available, including a planning skill
for AI voice agents and one for ConversationRelay, which is the usual way to put
a model in the middle of a live call. When a learner reaches the real build, use
those rather than guessing at the telephony — and run it through Stage 1 first,
because a phone number is a new kind of data collection and belongs in the spec.

**Budget the SME should hear before Week 2.** Per-minute telephony, per-minute
speech-to-text, per-character text-to-speech, per-token model, plus the number's
monthly rental. Five of those six are usage-based, which means a bad week or a
bot dialling you is a bill. Put a hard spend cap on every account on day one.
`AGENTS.md` rule 4 already says the agent never configures payments on the
learner's behalf; this is why.

## 3. Security an SME can actually run

An SME has no security team. The baseline below is the Australian Cyber Security
Centre's Essential Eight translated into things one person can do for a micro-app
in an afternoon, plus the application patterns Lyra already proves out.

### The afternoon list

| Control | What it means here | Done when |
| --- | --- | --- |
| Multi-factor authentication | On the code host, the hosting account, the model provider, the telephony account, and the email behind them | All five show MFA enabled |
| Secrets out of code | Keys live in the host's environment screen. The learner types them; the agent never sees them | A search of the repository finds no key |
| Least privilege | The app connects to its database as a **non-owner role**. Owners and superusers bypass row-level security, which is what makes isolation real rather than decorative | Lyra's `SECURITY.md` pattern, verified by a test |
| Patch the dependencies | A scheduled update, and a test suite that tells you if one breaks | `npm audit` clean, or every exception written down |
| Backups you have restored | A backup nobody has restored is a rumour | One restore performed, date recorded |
| Admin accounts | One named person. Not a shared login, not the trade's generic inbox | Written in the Trust Card |
| Audit log | Who did what, when — logins, exports, config changes | A table, not a log file that rotates away |
| A way to revoke | Bumping a token version kills every live session for a user | Lyra's `token_version` pattern |

### Voice adds five of its own

1. **Say it at the top of the call.** "You're speaking to an automated assistant,
   and this call is transcribed." Consent under the Australian Privacy Principles
   has to be informed, voluntary, current and specific, and commentary on OAIC
   guidance is clear that opt-out or implied consent is generally not good enough.
   Separately, the rules on *recording* a conversation differ state by state —
   get advice before you keep audio.
2. **Keep the transcript, not the audio.** Default to discarding the recording
   once you have the text. If you must keep audio, set a retention clock in the
   spec and actually delete on it.
3. **Do not do speaker verification.** The moment you use a voice to identify or
   verify who someone is — or store a voice template — you are arguably handling
   *sensitive information*, which carries a much higher consent bar. A plain
   recording or transcript is likely outside that definition; a voiceprint is
   not. Staying on the safe side of that line is a product decision, so put it in
   the spec as an explicit "we never do this".
4. **Never take card numbers by voice.** Not by speech, not by keypad, not
   "just this once". Send a payment link. Lyra's posture on this is the right one:
   card data never touches your server, so your scope stays small.
5. **Redact before you store.** A caller will read out a Medicare number, a date
   of birth or a card number whether you asked or not. Strip those patterns from
   the transcript before it is written down, and keep them out of your logs and
   out of anything you send to a model.

### And one that catches everyone

**Check what your providers do with the data.** You cannot promise a customer
"your call is never used for training" on a provider's behalf — Lyra's compliance
notes are blunt about this, and they are right. Name the providers you actually
use, link their data-use terms, and get a data processing agreement with each of
them: telephony, speech, model, hosting. If you cannot show the agreement, do not
make the claim.

## 4. The Australian picture, as at November 2026

Three things an SME audience usually has wrong.

**"We're under $3 million, so the Privacy Act doesn't apply to us."** Today that
is broadly right — section 6D still exempts most businesses with turnover of $3
million or less, and as of the most recent reporting it has not been repealed.
But removal has been agreed in principle pending an impact analysis, and the
August 2026 exposure draft left it out rather than settling it. Building a
customer-data business on an exemption the government has said it intends to
remove is a planning error, not a saving. Build as though it applies.

**"There's a deadline in December 2026."** The date doing the rounds in vendor
blogs is not the exemption. It is the automated-decision-making transparency duty
from the first tranche of reforms in the Privacy and Other Legislation Amendment
Act 2024. That one matters here directly: if your voice agent *decides* something
about a person rather than just taking a message — who gets an appointment, who
is turned away — you need to be able to say so in your privacy policy.

**"Our industry is small, nobody's looking."** Some businesses are already in
scope regardless of turnover; reporting indicates that from 1 July 2026 firms
providing AML/CTF designated services — accounting, legal, conveyancing, real
estate — are covered for their AML-related data handling. And the enforcement
precedent to show an SME is the Bunnings facial-recognition determination: the
OAIC found a breach of APP 3.3, collecting sensitive information without consent,
alongside the APP 5.1 notice obligation, and rejected the argument that a general
exception applied. That was a large retailer with lawyers. The lesson for a
five-person business is to not need the argument.

## 5. What the SME actually walks away with

Not an app. Three documents the kit already produces, plus one more:

1. **`spec.md`** — what it does, and the data it holds with a reason beside each
   line. This is the document that makes a privacy policy writable.
2. **`acceptance-checks.md`** — what is guaranteed, in sentences a customer can
   read, each backed by a test that runs.
3. **`trust-card.md`** — the customer-facing page: what it does, what it keeps,
   what was checked, **what is known to be missing**, who to contact.
4. **`SECURITY.md`** — new for the business version, written in Lyra's style:
   what is enforced, what is not yet, and what would have to be true before any
   claim gets made.

That fourth one is the commercial point, and it is worth making explicitly to an
SME room: their competitors will say "bank-grade security" and mean nothing by
it. A one-page document that states what is enforced *and what is not* is both
more honest and more persuasive, and they already have the trail to write it
from.

## 6. Three sentences to never say, and what to say instead

| Do not say | Say |
| --- | --- |
| "It's compliant." | "Here is what it enforces, here is what it doesn't, and here is who reviewed it." |
| "Bank-grade encryption." | "Content is encrypted with AES-256-GCM at rest." Name the algorithm; skip the adjective. |
| "Your data is never used for training." | "These are our providers and their data-use terms. Here are our agreements with them." |
