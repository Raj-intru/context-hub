// The brain. Text in, reply out. No audio, no browser, no network, no model.
//
// Why there is no language model in here: acceptance check 2 says the assistant
// must never invent an answer. That is a guarantee you can only make if the
// thing is incapable of inventing one. A keyword matcher that falls through to
// "I'll take a message" cannot hallucinate opening hours. This is also what
// makes checks 1-4 testable without a microphone.
//
// If a learner later wants a model in here, the seam is `classify()` — swap it,
// and keep every test.

export const INITIAL = Object.freeze({ stage: 'idle', draft: {} });

const DAYS = {
  monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday',
  thursday: 'Thursday', friday: 'Friday', saturday: 'Saturday',
  sunday: 'Sunday', tomorrow: 'tomorrow', today: 'today',
};

// Order matters: a booking beats a price question, because "can I get a quote
// on Tuesday" is someone trying to book.
const INTENTS = [
  { name: 'cancel', words: ['cancel', 'never mind', 'nevermind', 'forget it', 'stop'] },
  { name: 'book', words: ['book', 'booking', 'appointment', 'come out', 'come round', 'quote', 'slot', 'send someone'] },
  { name: 'hours', words: ['open', 'opening', 'hours', 'close', 'closing', 'what time', 'when are you'] },
  { name: 'location', words: ['where', 'address', 'located', 'find you', 'suburb', 'area', 'cover'] },
  { name: 'price', words: ['cost', 'price', 'how much', 'charge', 'rate', 'fee', 'expensive'] },
];

export function normalize(raw) {
  return String(raw || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function classify(text) {
  for (const intent of INTENTS) {
    if (intent.words.some((w) => text.includes(w))) return intent.name;
  }
  return 'unknown';
}

export function findDay(text) {
  for (const [key, label] of Object.entries(DAYS)) {
    if (text.includes(key)) return label;
  }
  return null;
}

export function findPhone(text) {
  const digits = String(text || '').replace(/[^0-9]/g, '');
  return digits.length >= 8 ? digits : null;
}

export function findName(text) {
  const cleaned = normalize(text)
    .replace(/^(my name is|my name s|the name is|it s|its|i m|i am|this is|call me)\s+/, '')
    .trim();
  if (!cleaned) return null;
  // One or two words is a name. A sentence is not.
  const words = cleaned.split(' ').filter(Boolean).slice(0, 3);
  if (!words.length) return null;
  return words.map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}

function ask(stage, draft, say) {
  return { state: { stage, draft }, say, action: 'ask' };
}

/**
 * @param {{stage:string, draft:object}} state
 * @param {string} raw        what the caller said
 * @param {object} cfg        the business config
 * @returns {{state:object, say:string, action:string, booking?:object}}
 */
export function reply(state, raw, cfg) {
  const current = state && state.stage ? state : INITIAL;
  const draft = { ...(current.draft || {}) };
  const text = normalize(raw);

  if (!text) {
    return { state: current, say: "Sorry, I didn't catch that.", action: 'retry' };
  }

  if (classify(text) === 'cancel') {
    return { state: { stage: 'idle', draft: {} }, say: 'No worries, cancelled.', action: 'cancelled' };
  }

  if (current.stage === 'awaiting_name') {
    const name = findName(raw);
    if (!name) return ask('awaiting_name', draft, 'Sorry, what name should I put down?');
    draft.name = name;
    return ask('awaiting_phone', draft, `Thanks ${name}. What's the best number to call you back on?`);
  }

  if (current.stage === 'awaiting_phone') {
    const phone = findPhone(raw);
    if (!phone) {
      return ask('awaiting_phone', draft, "I need a phone number with at least eight digits. What's the best number?");
    }
    draft.phone = phone;
    if (!draft.day) return ask('awaiting_day', draft, 'And what day suits you?');
    return confirm(draft);
  }

  if (current.stage === 'awaiting_day') {
    const day = findDay(text);
    if (!day) return ask('awaiting_day', draft, 'Which day would you like? Any weekday works.');
    draft.day = day;
    return confirm(draft);
  }

  switch (classify(text)) {
    case 'hours':
      return { state: INITIAL, say: cfg.hours, action: 'answer' };
    case 'location':
      return { state: INITIAL, say: cfg.location, action: 'answer' };
    case 'price':
      return { state: INITIAL, say: cfg.price, action: 'answer' };
    case 'book': {
      const day = findDay(text);
      if (day) draft.day = day;
      return ask('awaiting_name', draft, "Happy to book you in. What's your name?");
    }
    default:
      // Check 2. The assistant does not guess.
      return {
        state: INITIAL,
        say: "I'm not sure about that one, so I'll take a message and Dave will call you back.",
        action: 'message',
      };
  }
}

function confirm(draft) {
  const booking = { name: draft.name, phone: draft.phone, day: draft.day };
  return {
    state: { stage: 'idle', draft: {} },
    say: `Thanks ${booking.name}, you're booked in for ${booking.day}. We'll ring you on ${spaced(booking.phone)} to confirm.`,
    action: 'booked',
    booking,
  };
}

// Read a number back the way an Australian says it, so the caller can check it.
export function spaced(phone) {
  const d = String(phone).replace(/[^0-9]/g, '');
  if (d.length === 10 && d.startsWith('04')) return `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}`;
  if (d.length === 10) return `${d.slice(0, 2)} ${d.slice(2, 6)} ${d.slice(6)}`;
  return d.replace(/(\d{3})(?=\d)/g, '$1 ');
}
