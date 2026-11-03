// The dashboard's numbers, tested. Including the one that matters most: that
// nothing in here can hold what was said.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { record, summary, reset, all } from '../src/metrics.js';
import { ttsCost, summariseCost, RATES } from '../src/costs.js';

beforeEach(() => reset());

test('it records what happened and nothing about what was said', () => {
  record({
    action: 'answer', replyMs: 400, spokenCharacters: 120,
    // Everything below is thrown away. If this ever starts being kept, this
    // test fails and the Trust Card is a lie.
    transcript: 'my name is Rajesh', name: 'Rajesh', phone: '0412345678', audio: 'base64…',
  });
  const [row] = all();
  assert.deepEqual(Object.keys(row).sort(), ['action', 'at', 'cached', 'replyMs', 'spokenCharacters']);
  assert.equal(JSON.stringify(all()).includes('Rajesh'), false);
  assert.equal(JSON.stringify(all()).includes('0412'), false);
});

test('an unknown action is recorded as an error rather than trusted', () => {
  record({ action: 'something-made-up' });
  assert.equal(all()[0].action, 'error');
});

test('the message rate counts only turns that were a question', () => {
  record({ action: 'answer' }); record({ action: 'answer' });
  record({ action: 'message' });
  record({ action: 'ask' });          // a follow-up is not a failure to answer
  const s = summary();
  assert.equal(s.answered, 3);
  assert.equal(Number(s.messageRate.toFixed(3)), 0.333);
});

test('with nothing recorded, nothing is divided by zero', () => {
  const s = summary();
  assert.equal(s.messageRate, null);
  assert.equal(s.cost.costPerBookingUsd, null);
  assert.equal(s.cost.spentUsd, 0);
  assert.equal(s.latencyMs.p50, null);
});

test('percentiles use nearest rank, so small samples do not lie', () => {
  for (const replyMs of [100, 200, 300, 400, 900]) record({ action: 'answer', replyMs });
  const s = summary();
  assert.equal(s.latencyMs.p50, 300);
  assert.equal(s.latencyMs.p95, 900);
  assert.equal(s.latencyMs.worst, 900);
  assert.equal(s.latencyMs.samples, 5);
});

test('cached audio is free, so only new characters are billed', () => {
  record({ action: 'answer', spokenCharacters: 100, cached: true });
  record({ action: 'answer', spokenCharacters: 100 });
  const s = summary({ provider: 'cartesia' });
  assert.equal(s.totals.spokenCharacters, 200);
  assert.equal(s.cost.billableCharacters, 100);
  assert.equal(s.cost.spentUsd, ttsCost(100, 'cartesia'));
});

test('cost per booking, the number an SME decides on', () => {
  record({ action: 'booked', spokenCharacters: 1000 });
  record({ action: 'booked', spokenCharacters: 1000 });
  const s = summary({ provider: 'elevenlabs', jobValueUsd: 90 });
  assert.equal(s.totals.bookings, 2);
  assert.equal(s.cost.costPerBookingUsd, ttsCost(2000, 'elevenlabs') / 2);
  assert.ok(s.cost.returnPerBooking > 89, 'a booking should cost pennies against a $90 job');
});

test('the browser voice costs nothing at all', () => {
  assert.equal(ttsCost(10_000, 'browser'), 0);
  assert.equal(ttsCost(10_000, 'nonexistent-provider'), 0);
});

test('the spend meter knows when it is near the cap', () => {
  const totals = { turns: 1, bookings: 0, spokenCharacters: 500_000, cachedCharacters: 0 };
  const c = summariseCost(totals, { provider: 'elevenlabs', monthlyCapUsd: 20 });
  assert.equal(c.spentUsd, (500_000 * RATES.tts.elevenlabs) / 1e6);   // $40
  assert.ok(c.capUsedPercent > 100, 'over the cap should read over 100%');
});

test('the event log is capped, so a demo link cannot grow forever', () => {
  for (let i = 0; i < 2100; i += 1) record({ action: 'answer' });
  assert.equal(all().length, 2000);
});
