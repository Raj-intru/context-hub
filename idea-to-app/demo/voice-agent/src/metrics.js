// Stats, not chats.
//
// This records what happened, never what was said. No transcript, no name, no
// phone number, no audio — there is no code path here that could hold any. That
// is the same rule Lyra's dashboards follow, and it is what lets an SME show a
// customer the dashboard without showing them somebody's phone call.
//
// In memory, like the bookings, and for the same reasons.
import { summariseCost, DEFAULTS } from './costs.js';

const MAX_EVENTS = 2000;
const events = [];

export const ACTIONS = ['answer', 'message', 'booked', 'ask', 'retry', 'cancelled', 'error'];

export function record(event = {}) {
  const action = ACTIONS.includes(event.action) ? event.action : 'error';
  const row = {
    at: new Date().toISOString(),
    action,
    // How long the caller waited between finishing their sentence and hearing a
    // reply. The single number that decides whether a voice agent feels alive.
    replyMs: Number.isFinite(event.replyMs) && event.replyMs >= 0 ? Math.round(event.replyMs) : null,
    spokenCharacters: Number.isFinite(event.spokenCharacters) ? Math.max(0, Math.round(event.spokenCharacters)) : 0,
    cached: Boolean(event.cached),
  };
  events.push(row);
  if (events.length > MAX_EVENTS) events.shift();
  return row;
}

export const all = () => events.slice();
export function reset() { events.length = 0; }

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

export function summary(opts = {}) {
  const byAction = Object.fromEntries(ACTIONS.map((a) => [a, 0]));
  let spokenCharacters = 0, cachedCharacters = 0;
  const latencies = [];

  for (const e of events) {
    byAction[e.action] += 1;
    spokenCharacters += e.spokenCharacters;
    if (e.cached) cachedCharacters += e.spokenCharacters;
    if (e.replyMs !== null) latencies.push(e.replyMs);
  }

  latencies.sort((a, b) => a - b);
  const answered = byAction.answer + byAction.message;

  const totals = {
    turns: events.length,
    bookings: byAction.booked,
    spokenCharacters,
    cachedCharacters,
  };

  return {
    totals,
    byAction,
    // The honest quality number: how often it had to say "I'll take a message"
    // instead of answering. Only countable because it never guesses.
    messageRate: answered ? byAction.message / answered : null,
    answered,
    latencyMs: {
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      worst: latencies.length ? latencies[latencies.length - 1] : null,
      samples: latencies.length,
    },
    cost: summariseCost(totals, { ...DEFAULTS, ...opts }),
    since: events.length ? events[0].at : null,
  };
}
