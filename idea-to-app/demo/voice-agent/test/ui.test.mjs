// The browser half. Drives the real page against the real server, with the
// speech engine stubbed — so these run in CI, on a laptop, and on a plane.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { server } from '../server.js';

// CJS resolution, so this finds Playwright whether it is installed in this
// project or globally on the machine running the demo.
const { chromium } = createRequire(import.meta.url)('playwright');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let browser, base;

// Stubs the browser speech engine before the page's own script runs.
const stubSpeech = (page, mode) => page.addInitScript((m) => {
  class FakeRecognition {
    constructor() { this.lang = ''; this.onresult = null; this.onerror = null; this.onend = null; }
    start() {
      if (m === 'denied') setTimeout(() => this.onerror && this.onerror({ error: 'not-allowed' }), 0);
      if (m === 'heard') setTimeout(() => this.onresult && this.onresult({ results: [[{ transcript: 'what time do you open' }]] }), 10);
      // m === 'silent': never calls back, which is the point of check 6.
    }
    stop() { if (this.onend) this.onend(); }
  }
  window.SpeechRecognition = FakeRecognition;
  delete window.webkitSpeechRecognition;
}, mode);

before(async () => {
  await rm(join(ROOT, 'data'), { recursive: true, force: true });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ args: ['--no-sandbox'] });
});

after(async () => {
  if (browser) await browser.close();
  await new Promise((r) => server.close(r));
});

test('checks 1-4 — the whole conversation works through the real page', async () => {
  const page = await browser.newPage();
  await stubSpeech(page, 'silent');
  await page.goto(base);

  await page.evaluate(() => window.__assistant.send('what time do you open'));
  assert.match(await page.textContent('#said'), /on the tools Monday to Friday/);

  await page.evaluate(() => window.__assistant.send('do you do roof tiling'));
  assert.match(await page.textContent('#said'), /take a message/);

  await page.evaluate(() => window.__assistant.send('book me in for tuesday'));
  assert.match(await page.textContent('#said'), /name/i);
  await page.evaluate(() => window.__assistant.send('Rajesh'));
  assert.match(await page.textContent('#said'), /number/i);
  await page.evaluate(() => window.__assistant.send('0412 345 678'));
  assert.match(await page.textContent('#said'), /booked in for Tuesday/);

  // It reached the server and came back on the list.
  await page.waitForSelector('#bookings li:not(.empty)');
  const row = await page.textContent('#bookings li');
  assert.match(row, /Rajesh/);
  assert.match(row, /Tuesday/);
  await page.close();
});

test('check 5 — a refused microphone gives a box to type in, not a dead page', async () => {
  const page = await browser.newPage();
  await stubSpeech(page, 'denied');
  await page.goto(base);

  await page.locator('#talk').dispatchEvent('pointerdown');
  await page.waitForSelector('#typed:not([hidden])');
  assert.match(await page.textContent('#status'), /permission/i);
  assert.equal(await page.locator('#talk').isDisabled(), true);

  // And the fallback actually works.
  await page.fill('#typedInput', 'how much does it cost');
  await page.click('#typedForm button');
  await page.waitForFunction(() => document.getElementById('said').textContent.includes('ninety dollars'));
  await page.close();
});

test('check 6 — five seconds of silence stops it listening instead of hanging', async () => {
  const page = await browser.newPage();
  await stubSpeech(page, 'silent');
  await page.goto(`${base}/?silence=250`);

  await page.locator('#talk').dispatchEvent('pointerdown');
  assert.equal(await page.getAttribute('#talk', 'data-listening'), 'true');

  await page.waitForFunction(() => document.getElementById('status').textContent.includes('stopped listening'), null, { timeout: 4000 });
  assert.equal(await page.getAttribute('#talk', 'data-listening'), 'false');
  await page.close();
});

test('check 7 — on a phone, the Talk button is reachable without zooming', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await stubSpeech(page, 'silent');
  await page.goto(base);

  const talk = page.locator('#talk');
  assert.equal(await talk.isVisible(), true);

  const box = await talk.boundingBox();
  assert.ok(box.height >= 44, `touch target is ${box.height}px tall, needs 44`);
  assert.ok(box.y + box.height <= 844, 'the button is below the fold on a phone');

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 0, `the page scrolls sideways by ${overflow}px`);
  await page.close();
});

test('the dashboard shows what it cost and how it went', async () => {
  const page = await browser.newPage();
  await stubSpeech(page, 'silent');
  await page.goto(base);

  // Three turns: one answered, one it could not answer, one booking.
  await page.evaluate(async () => {
    await window.__assistant.send('what time do you open');
    await window.__assistant.send('do you do roof tiling');
    await window.__assistant.send('book me in for friday');
    await window.__assistant.send('Sam');
    await window.__assistant.send('0412 000 111');
  });

  await page.goto(`${base}/dashboard.html`);
  await page.waitForFunction(() => document.getElementById('heroValue').textContent !== '—');

  // The hero is a cost, not a placeholder.
  assert.match(await page.textContent('#heroValue'), /^\$\d/);
  // The KPI row names the business outcome and the honest quality number.
  const kpis = await page.textContent('#kpis');
  assert.match(kpis, /Bookings taken/);
  assert.match(kpis, /Took a message/);
  // The segmented bar drew a segment per kind of ending, with a labelled legend.
  assert.ok((await page.locator('#stack .seg').count()) >= 3, 'expected at least three segments');
  assert.match(await page.textContent('#stackLegend'), /Took a booking/);
  // Identity is never colour alone: every legend row carries its name and count.
  assert.equal(await page.locator('#stackLegend li .nm').count(), 4);
  // And the relief rule's table view exists and is populated.
  assert.ok((await page.locator('#tableView tbody tr').count()) >= 10);

  // The promise the Trust Card makes: the page cannot leak what was said.
  const body = await page.textContent('body');
  assert.doesNotMatch(body, /Sam|0412/, 'the dashboard must not show caller details');
  await page.close();
});

test('the microphone path itself works when the engine does respond', async () => {
  const page = await browser.newPage();
  await stubSpeech(page, 'heard');
  await page.goto(base);

  await page.locator('#talk').dispatchEvent('pointerdown');
  await page.waitForFunction(() => document.getElementById('heard').textContent.includes('what time'));
  assert.match(await page.textContent('#said'), /on the tools/);
  await page.close();
});
