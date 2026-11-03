# Guardrail 2 — Scale

**The principle:** build for the launch you can actually imagine, not the one in
the pitch deck. Over-engineering kills four-week projects more often than
traffic does.

Read this at Stage 1, and again before you build any list, search or report screen.

## Start by naming the number

Ask the learner, one question at a time, and write the answers into `spec.md`:

- How many people will use this in the first month?
- How many in the busiest hour? (Launch day, Monday morning, end of term.)
- How much will the app be holding after a year — tens of records, or millions?

Everything below follows from those three numbers.

## The three sizes

| Size | Month one | What it needs |
| --- | --- | --- |
| **Small** | Up to a few hundred people | The default stack, free plans, no special work. Almost every Version 1 lives here. |
| **Medium** | Thousands | Paginated lists, indexes on the columns you filter by, slow work moved to the background |
| **Large** | Tens of thousands or more | Out of scope for four weeks. Say so plainly and put it in Version 2 with a note on what would change. |

If the learner believes they are Large, ask what the first month honestly looks
like. Almost always the answer is Small, and building Small is what gets them live.

## The four things that break first

In this order, nearly every time:

1. **Lists that load everything.** A screen that fetches every record and then
   filters in the browser works for twenty rows and dies at two thousand.
   Paginate from the start: it costs nothing today.
2. **Missing indexes.** Any column you filter or sort by needs one. Without it
   the database reads every row, every time.
3. **Repeated queries in a loop.** One query per row on screen instead of one
   query for the screen. Fetch what you need in one request.
4. **Slow work done while the visitor waits.** Sending email, resizing images,
   calling another service. Do it in the background and tell the visitor it is
   in hand.

## Design rules that cost nothing now

- Paginate or limit every list, from the first version
- Index the columns you filter and sort by
- Fetch the fields you display, not whole rows
- Put slow or chargeable work behind a queue or a background job
- Cap the size of anything a visitor can upload or submit

## What Version 1 does not need

Say no to these kindly, and record them in "Version 2" if the learner asks:
caching layers, message queues for their own sake, more than one database,
microservices, multiple regions, autoscaling rules, load balancers you configure
by hand. The default host handles the Small case without any of it.

## The scale check (Stage 3)

Fill the app with far more data than the learner expects — a few thousand rows —
and open the busiest screen again. Report the before and after in seconds. If it
slowed down, fix the cause; never hide it behind a loading spinner.

Then answer in one line, for the Trust Card: **what would this app do if a
hundred people arrived at once?**
