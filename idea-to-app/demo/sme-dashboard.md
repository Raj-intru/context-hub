# Cost and performance monitoring — standard on every SME build

An SME does not need a chart. They need the answer to three questions, and they
need it without ringing anyone:

1. **What is this costing me?**
2. **Is it working?**
3. **When does it embarrass me?**

Everything on the dashboard earns its place by answering one of those. If a number
answers none of them, it comes off. There is a working one at
`voice-agent/public/dashboard.html`; this file is why it looks like that.

## The headline is cost per outcome, not cost

"You spent $4.12 this month" means nothing to a sole trader. **"Each booking cost
you 1.4 cents, and a call-out is worth $90"** ends the conversation. Lead with
cost per outcome and put the raw spend in the second row, because the ratio is
the thing they are actually deciding.

Pick the outcome from the spec's own must-haves — bookings for a trade, enquiries
for a consultancy, tickets deflected for a support line. Whatever Stage 1 called
success is the denominator.

## The five numbers, and why each one

| Number | The question it answers | Why this one |
| --- | --- | --- |
| **Cost per outcome** | What is it costing me? | The only cost figure with a decision attached |
| **Outcomes taken** | Is it working? | The business result, not a proxy for it |
| **"Took a message" rate** | When does it embarrass me? | See below — this is the good one |
| **Reply time, median and worst** | Is it working? | On a voice line, latency *is* the quality |
| **Spend against a cap** | What is it costing me? | Five of six cost lines are usage-based: a bad week is a bill |

### The message rate is the honest quality metric

Most AI products cannot tell you how often they were wrong, because a confident
wrong answer looks exactly like a right one. This build can, and it is a
consequence of the design decision in `voice-agent/project-docs/decision-log.md`:
the brain has no language model in it, so it cannot invent an answer. Every time
it does not know, it says "I'll take a message" — and that is a countable event.

So the quality number is not an estimate or a sample of reviewed calls. It is
exactly the rate at which the thing hit the edge of what it knows. An SME can
watch it, and when it climbs, the fix is obvious: another answer to add.

Say this part out loud in a demo. "It can tell you how often it didn't know"
lands harder than any accuracy claim, because the audience has been told accuracy
claims before.

### Latency, said properly

Measure from the end of the caller's sentence to the start of the reply, and show
the median and the worst. Over roughly a second and a half it starts to feel like
a bad line, and people talk over it. Averages hide the bad calls, so show the
worst one next to the typical one.

## The two rules the dashboard follows

**Stats, not chats.** It counts what happened and holds no transcript, no name,
no phone number and no audio. This is Lyra's `docs/SECURITY.md` pattern —
dashboards read a content-free event table, and there is no code path from the
dashboard to anyone's conversation. It is also what makes the dashboard
*showable*: an SME can put it on a screen in the shop without putting a
customer's phone call on a screen in the shop. There is a test for it
(`test/metrics.test.js`) that fails if caller details ever reach the event log.

**Every cost is an estimate until the invoice arrives.** The figures come from a
local rate table, and rates move. The page says so, in those words. Quoting a
client from a dashboard estimate is how you end up explaining a bill.

## What a real business needs that the reference build does not have

Say all four of these before an SME relies on it.

| Gap | Why it matters | What to do |
| --- | --- | --- |
| **No password on the dashboard** | It shows business performance to anyone with the link | Put it behind the same login as the rest of the admin. First thing |
| **Costs are modelled, not read** | The rate table drifts from reality | Pull actual spend from each provider's usage API and show both |
| **The cap is a label, not a brake** | Showing "110% of cap" does not stop the spending | Make the cap enforce: degrade to a recorded message, then alert |
| **Nobody is told** | A dashboard only works if someone looks at it | A weekly summary and one threshold alert. A sole trader will not open a page |

## Making it standard

For an SME build, the dashboard is not an extra — it ships with the app, and the
stages say so:

- **Stage 1** — the spec names the outcome the dashboard will count, and the
  monthly cap, in the learner's own words.
- **Stage 2** — the metrics layer goes in with the first feature, not after.
  Retrofitting instrumentation means guessing at what last month cost.
- **Stage 3** — the data review covers the event table too, and confirms there is
  no path from it to a conversation.
- **Stage 4** — the Trust Card's *What it costs to run* section is filled in from
  the dashboard's own numbers, and the pre-flight checks it is behind a login.
