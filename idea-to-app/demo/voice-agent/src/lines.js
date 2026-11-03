// Every line the assistant can say that does not contain a caller's details.
// `npm run voice` turns these into MP3 files so the demo plays them from disk:
// no latency, no network, no key needed while you are standing in front of
// people. Lines with a name or number in them are not here — they fall back to
// the browser voice, or get synthesised once and cached on first use.
import { business } from './business.js';

export const fixedLines = [
  business.hours,
  business.location,
  business.price,
  "I'm not sure about that one, so I'll take a message and Dave will call you back.",
  "Happy to book you in. What's your name?",
  'Sorry, what name should I put down?',
  "I need a phone number with at least eight digits. What's the best number?",
  'And what day suits you?',
  'Which day would you like? Any weekday works.',
  "Sorry, I didn't catch that.",
  'No worries, cancelled.',
  `You've called ${business.name}. Dave's on the tools, so I can help. Ask about our hours, where we work, what it costs, or say "book me in".`,
];
