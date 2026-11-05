# Guardrail 4 — Cost

**The principle:** the learner must always be able to answer two questions —
*what does this cost me this month?* and *what is the worst it could cost me?*
If they cannot answer both, stop building and fix that first.

This is the guardrail that most often hurts a first-time builder. Nobody gets
hurt by an app that is slightly slow. People do get hurt by a bill that arrives
a month after launch.

Read this at Stage 0, before adding any paid service, and at the Stage 3 review.

## The four rules

### 1. Free plans for Version 1
Every service in the default stack has a free plan that comfortably covers a
first month of real use. Build inside those plans. If the idea cannot be built
free or near-free, say so at Stage 0, not in Week 4.

### 2. Every paid service needs a yes, a cap and an alert
Not one of the three — all three, in the same conversation turn:
- The learner's explicit **yes**, after you have named the cost per use
- A **hard spending cap** where the provider offers one
- A **budget alert** at 50% and 80% of what the learner says they can afford

A service with no cap and no alert is not approved, however small it looks.

### 3. Anything a stranger can trigger has a limit
A public form, search, upload or AI call can be run ten thousand times by one
person. Rate-limit it. This is the same rule as security rule 7, because the
bill and the breach come through the same door.

### 4. The owner can turn it off in five minutes
Write the shutdown steps into `project-docs/ops-card.md`: where to pause the
app, where to disable the paid service, and what the owner should do first if a
bill looks wrong. Check the steps actually work before launch.

## What runs away

Name these when you review. Each has produced real surprise bills:

- An AI or messaging call inside a loop, or on every keystroke
- A function that retries forever when something downstream is broken
- A scheduled job left running after the thing it fed was removed
- Image, audio or video processing on upload, with no size cap
- A query with no limit on a table that grew
- Data leaving the host (egress) because something is fetched on every page load
- A public endpoint with no rate limit, found by a bot
- A free trial that silently became a paid plan

## Reading the numbers

The learner's hosting, database and any paid API each have their own usage page.
You cannot sign in as them and you should not try. Instead, at every review:

> "Open your hosting dashboard and your database dashboard, and read me the
> numbers on each: spend this month, and how much of the free allowance you have
> used."

Then write them into `project-docs/ops-card.md` from `templates/ops-card.md`,
work out the headroom, and tell the learner in plain numbers what the month
looks like and what the worst case would be.

## What you never do

- Enter card details, or ask the learner to put card details in the chat
- Raise a limit, upgrade a plan or accept a paid tier on the learner's behalf
- Add a paid service because it is convenient for you
- Describe a cost as "tiny" or "basically free" without naming the actual number
