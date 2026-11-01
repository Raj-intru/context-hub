/**
 * Clock and calendar helpers.
 *
 * Everything that reads the current time goes through a clock object so the
 * tests can pin "now" to a Friday afternoon after cut-off and assert the
 * policy decision, rather than being a test that passes on Tuesdays.
 */
export function systemClock() {
  return { now: () => new Date() };
}

export function fixedClock(iso) {
  const at = new Date(iso);
  return { now: () => new Date(at) };
}

/** Wall-clock parts of `date` in an IANA zone, without pulling in a tz library. */
export function zonedParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    weekday: 'short',
  });
  const parts = {};
  for (const { type, value } of fmt.formatToParts(date)) parts[type] = value;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour === '24' ? '0' : parts.hour),
    minute: Number(parts.minute),
    weekday: parts.weekday, // Mon, Tue, ...
    minutesOfDay: Number(parts.hour === '24' ? '0' : parts.hour) * 60 + Number(parts.minute),
  };
}

const WEEKEND = new Set(['Sat', 'Sun']);

export function isBusinessDay(date, timeZone, holidays = []) {
  const { weekday, date: ymd } = zonedParts(date, timeZone);
  return !WEEKEND.has(weekday) && !holidays.includes(ymd);
}

/** "16:00" -> 960 */
export function parseClockTime(hhmm) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(hhmm));
  if (!m) throw new Error(`Malformed clock time: ${hhmm}`);
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) throw new Error(`Out-of-range clock time: ${hhmm}`);
  return hours * 60 + minutes;
}

/**
 * Next value date for a payment rail, given its cut-off. Instructions after
 * cut-off, on a weekend, or on a holiday roll to the next business day — the
 * single most common source of "the agent said it would arrive today".
 */
export function resolveValueDate(date, { timeZone, cutOff, holidays = [], lagDays = 0 }) {
  const parts = zonedParts(date, timeZone);
  let cursor = new Date(date);
  let afterCutOff = cutOff ? parts.minutesOfDay >= parseClockTime(cutOff) : false;

  if (afterCutOff || !isBusinessDay(cursor, timeZone, holidays)) {
    cursor = nextBusinessDay(cursor, timeZone, holidays);
  }
  for (let i = 0; i < lagDays; i += 1) {
    cursor = nextBusinessDay(cursor, timeZone, holidays);
  }
  return zonedParts(cursor, timeZone).date;
}

function nextBusinessDay(date, timeZone, holidays) {
  let cursor = new Date(date.getTime());
  do {
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  } while (!isBusinessDay(cursor, timeZone, holidays));
  return cursor;
}
