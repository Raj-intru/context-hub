// Reads the content-free rollup and draws it. No library, no build step.
const $ = (id) => document.getElementById(id);

const money = (n, dp = 2) => '$' + Number(n || 0).toFixed(dp);
const pct = (n) => (n === null || n === undefined) ? '—' : Math.round(n * 100) + '%';
const ms = (n) => (n === null || n === undefined) ? '—' : n >= 1000 ? (n / 1000).toFixed(1) + 's' : Math.round(n) + 'ms';

// One whole split into four parts. Categorical slots 1-4, fixed order, never cycled.
const SEGMENTS = [
  { key: 'answer', name: 'Answered the question', slot: 1 },
  { key: 'message', name: 'Took a message', slot: 2 },
  { key: 'booked', name: 'Took a booking', slot: 3 },
  { key: 'other', name: 'Asked a follow-up', slot: 4 },
];

function render(s) {
  const t = s.totals, c = s.cost;

  // ---- hero: the number that decides whether an SME keeps it running ----
  // On the browser's free voice every figure is $0, which reads as broken rather
  // than free — so price it as if a paid voice spoke every line.
  const perBooking = c.free ? c.referenceCostPerBookingUsd : c.costPerBookingUsd;
  $('heroLabel').textContent = c.free
    ? 'What each booking would cost with a paid voice'
    : 'What each booking cost to take';

  if (perBooking === null) {
    $('heroValue').textContent = '—';
    $('heroNote').textContent = 'No bookings yet. Take one on the assistant and this fills in.';
  } else {
    $('heroValue').textContent = money(perBooking, 4);
    $('heroNote').textContent = c.free
      ? `Right now it costs nothing — the browser's own voice is free. On ${c.referenceProvider} it would be about ${money(perBooking, 4)} a booking, against a ${money(c.jobValueUsd, 0)} call-out.`
      : `Each booking cost about ${money(perBooking, 4)} to take. One call-out is worth ${money(c.jobValueUsd, 0)}.`;
  }

  // ---- KPI row ----
  $('kpis').innerHTML = [
    { k: 'Bookings taken', v: t.bookings, n: 'the business outcome' },
    { k: 'Questions handled', v: s.answered, n: `${t.turns} turns in total` },
    { k: 'Took a message', v: pct(s.messageRate), n: 'could not answer — never guessed' },
    { k: 'Typical wait', v: ms(s.latencyMs.p50), n: `worst ${ms(s.latencyMs.worst)}` },
  ].map((x) => `<div class="kpi"><div class="k">${x.k}</div><div class="v">${x.v}</div><div class="n">${x.n}</div></div>`).join('');

  // ---- meter: one ratio against a limit, with icon + label, never colour alone ----
  const used = Math.max(0, Math.min(100, c.capUsedPercent));
  const level = used >= 90 ? 'critical' : used >= 60 ? 'warning' : 'good';
  const label = { good: 'Well inside your cap', warning: 'Over halfway through your cap', critical: 'Close to your cap' }[level];
  const mark = { good: '✓', warning: '!', critical: '!!' }[level];
  $('meterSpent').textContent = c.free ? `${money(c.spentUsd, 2)} spent` : `${money(c.spentUsd, 4)} spent`;
  $('meterCap').textContent = c.free
    ? `cap ${money(c.capUsd, 2)} · browser voice, free`
    : `cap ${money(c.capUsd, 2)} · voice: ${c.provider}`;
  $('meterFill').style.width = Math.max(used, t.turns ? 1 : 0) + '%';
  $('meterFill').style.background = `var(--status-${level})`;
  $('meterStatus').innerHTML =
    `<span class="dot" style="background:var(--status-${level})"></span><span aria-hidden="true">${mark}</span> ${label} — ${used < 1 ? 'under 1' : Math.round(used)}% used`;

  // ---- tall segmented bar + legend with direct labels (the relief rule) ----
  const other = s.byAction.ask + s.byAction.retry + s.byAction.cancelled + s.byAction.error;
  const counts = { answer: s.byAction.answer, message: s.byAction.message, booked: s.byAction.booked, other };
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  $('stack').innerHTML = total
    ? SEGMENTS.filter((seg) => counts[seg.key] > 0)
        .map((seg) => `<div class="seg" style="height:${(counts[seg.key] / total) * 100}%;background:var(--series-${seg.slot})"></div>`).join('')
    : '';
  $('stackLegend').innerHTML = total
    ? SEGMENTS.map((seg) => `<li><span class="sw" style="background:var(--series-${seg.slot})"></span><span class="nm">${seg.name}</span><span class="ct">${counts[seg.key]}</span></li>`).join('')
    : '<li class="empty">Nothing yet.</li>';

  // ---- latency ----
  const lat = s.latencyMs;
  if (!lat.samples) {
    $('latency').innerHTML = '<p class="empty">No replies measured yet.</p>';
  } else {
    const rows = [
      ['Half of calls', lat.p50],
      ['19 in 20', lat.p95],
      ['Worst', lat.worst],
    ];
    const max = Math.max(...rows.map((r) => r[1] || 0), 1);
    $('latency').innerHTML =
      `<div class="bars">${rows.map(([name, v]) =>
        `<div class="bar-row"><span>${name}</span><span><span class="bar" style="width:${Math.max(2, ((v || 0) / max) * 100)}%"></span></span><span class="ct">${ms(v)}</span></div>`
      ).join('')}</div>
      <p class="caveat" style="margin:.7rem 0 0">Measured from the end of the caller's sentence to the start of the reply, in the browser. Over about a second and a half starts to feel like a bad line. ${lat.samples} measured.</p>`;
  }

  // ---- table view ----
  $('tableView').querySelector('tbody').innerHTML = [
    ['Turns in total', t.turns],
    ['Questions answered', s.byAction.answer],
    ['Messages taken', s.byAction.message],
    ['Bookings taken', s.byAction.booked],
    ['Follow-up questions asked', s.byAction.ask],
    ['Could not hear', s.byAction.retry],
    ['Cancelled by the caller', s.byAction.cancelled],
    ['Errors', s.byAction.error],
    ['Characters spoken', t.spokenCharacters],
    ['— of those, free (cached, or the browser voice)', t.cachedCharacters],
    [`If every line were spoken by ${s.cost.referenceProvider}`, money(c.referenceSpentUsd, 4)],
    ['Billable characters', c.billableCharacters],
    ['Estimated spend', money(c.spentUsd, 4)],
    ['Estimated cost per turn', money(c.costPerTurnUsd, 4)],
    ['Reply time, median', ms(lat.p50)],
    ['Reply time, 95th percentile', ms(lat.p95)],
  ].map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
}

async function load() {
  try {
    render(await (await fetch('api/usage')).json());
  } catch {
    document.querySelector('main').insertAdjacentHTML('beforeend',
      '<p class="caveat">Could not read the numbers. Is the assistant running?</p>');
  }
}

load();
setInterval(load, 5000);          // a demo audience wants to watch it move
window.__dashboard = { load, render };
