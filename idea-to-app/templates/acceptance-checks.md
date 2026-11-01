# Acceptance checks

Plain English. Every check has an automated test, and every test runs before any
step is called done. A check that cannot be tested gets rewritten until it can.

**Last full run:** [date] — [n of n passing]

## Core flow

| # | When I… | I should… | Test | Status |
| --- | --- | --- | --- | --- |
| 1 | [open the home page] | [see the Book button] | `[test file:name]` | — |

## When things go wrong

| # | When I… | I should… | Test | Status |
| --- | --- | --- | --- | --- |
| 2 | [send the form empty] | [see "Please add a date" and stay on the page] | `[test file:name]` | — |

## On a phone

| # | When I… | I should… | Test | Status |
| --- | --- | --- | --- | --- |
| 3 | [open it on my phone] | [reach every button without zooming] | `[test file:name]` | — |
