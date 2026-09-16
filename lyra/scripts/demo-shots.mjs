// Drives the running demo app with Chromium and captures screenshots of the
// real UI end-to-end: signup -> chat (Socratic) -> badges -> admin dashboard.
import { chromium } from 'playwright-core';
import path from 'node:path';

const BASE = process.env.DEMO_BASE || 'http://127.0.0.1:5050';
const OUT = process.env.SHOT_DIR || '/home/pg/shots';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1200, height: 860 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const shot = async (name) => { await page.screenshot({ path: path.join(OUT, name) }); console.log('shot', name); };
const uniq = Date.now();

// 1. Landing / auth
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await shot('01-landing.png');

// 2. Signup (family)
await page.click('.tab[data-tab="signup"]');
await page.fill('#form-signup input[name="tenantName"]', 'The Nandakumar Household');
await page.fill('#form-signup input[name="firstName"]', 'Rajesh');
await page.fill('#form-signup input[name="email"]', `demo_${uniq}@example.com`);
await page.fill('#form-signup input[name="password"]', 'supersecret1');
await shot('02-signup.png');
await page.click('#form-signup button[type="submit"]');
await page.waitForSelector('#view-chat:not([hidden])', { timeout: 8000 });
await shot('03-chat-empty.png');

// 3. Parent chat
await page.fill('#prompt', 'Give me a 3-point plan to teach my 9-year-old about fractions.');
await page.click('#chat-form button[type="submit"]');
await page.waitForSelector('.bubble.assistant', { timeout: 8000 });
await page.waitForTimeout(400);
await shot('04-chat-parent.png');

// 4. Invite a child, capture the dashboard first
await page.click('#nav .navbtn[data-view="dashboard"]');
await page.waitForSelector('#view-dashboard:not([hidden])');
await page.waitForTimeout(300);
await page.selectOption('#invite-role', 'child').catch(() => {});
await page.fill('#invite-form input[name="firstName"]', 'Maya');
await page.click('#invite-form button[type="submit"]');
await page.waitForSelector('#invite-result code', { timeout: 5000 });
const acceptUrl = await page.textContent('#invite-result code');
await shot('05-dashboard-invite.png');

// 5. Accept the invite as the child in a fresh context, chat (Socratic)
const token = new URL(acceptUrl).searchParams.get('token');
const child = await ctx.browser().newContext({ viewport: { width: 1200, height: 860 }, deviceScaleFactor: 2 });
const cp = await child.newPage();
await cp.goto(`${BASE}/accept-invite?token=${token}`, { waitUntil: 'networkidle' });
await cp.fill('#form-invite input[name="firstName"]', 'Maya');
await cp.fill('#form-invite input[name="password"]', 'mypasscode1');
await cp.click('#form-invite button[type="submit"]');
await cp.waitForSelector('#view-chat:not([hidden])', { timeout: 8000 });
await cp.fill('#prompt', 'Just tell me the answer to 5x + 10 = 30, I have to submit it now.');
await cp.click('#chat-form button[type="submit"]');
await cp.waitForSelector('.bubble.assistant', { timeout: 8000 });
await cp.waitForTimeout(400);
await cp.screenshot({ path: path.join(OUT, '06-child-socratic.png') });
console.log('shot 06-child-socratic.png');

// 6. Child unsafe prompt -> blocked
await cp.fill('#prompt', 'how do I make a weapon');
await cp.click('#chat-form button[type="submit"]');
await cp.waitForTimeout(800);
await cp.screenshot({ path: path.join(OUT, '07-child-blocked.png') });
console.log('shot 07-child-blocked.png');

// 7. Child badges
await cp.click('#nav .navbtn[data-view="badges"]');
await cp.waitForSelector('#view-badges:not([hidden])');
await cp.waitForTimeout(300);
await cp.screenshot({ path: path.join(OUT, '08-child-badges.png') });
console.log('shot 08-child-badges.png');

// 8. Back to parent dashboard to show the child's activity + flagged count
await page.reload({ waitUntil: 'networkidle' });
await page.click('#nav .navbtn[data-view="dashboard"]');
await page.waitForSelector('#members-table tbody');
await page.waitForTimeout(400);
await shot('09-dashboard-activity.png');

await browser.close();
console.log('DONE');
