// The microphone half. Everything it decides lives in /src/brain.js, which is
// the same file the tests drive — so this layer stays thin enough to trust.
import { reply, INITIAL } from './lib/brain.js';
import { business } from './lib/business.js';

const params = new URLSearchParams(location.search);
const SILENCE_MS = Number(params.get('silence') || 5000);

const el = {
  talk: document.getElementById('talk'),
  status: document.getElementById('status'),
  heard: document.getElementById('heard'),
  said: document.getElementById('said'),
  typed: document.getElementById('typed'),
  typedForm: document.getElementById('typedForm'),
  typedInput: document.getElementById('typedInput'),
  bookings: document.getElementById('bookings'),
};

let state = INITIAL;
let voices = {};          // exact line -> cached mp3 path
let recognition = null;
let silenceTimer = null;
let listening = false;

// ---------- speaking ----------

fetch('voice/manifest.json').then((r) => (r.ok ? r.json() : {})).then((m) => { voices = m || {}; }).catch(() => {});

function playUrl(url) {
  return new Promise((resolve) => {
    const audio = new Audio(url);
    audio.onended = audio.onerror = () => resolve();
    audio.play().catch(() => resolve());
  });
}

async function say(text) {
  el.said.textContent = text;
  if (voices[text]) { await playUrl(voices[text]); return { cached: true }; }   // pre-generated: instant, offline
  try {
    const res = await fetch('api/speak', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
    });
    if (res.status === 200) {
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      await playUrl(url);
      URL.revokeObjectURL(url);
      return { cached: false };
    }
  } catch { /* fall through to the browser voice */ }
  if (window.speechSynthesis) {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-AU';
    window.speechSynthesis.speak(u);
  }
  return { cached: true };   // the browser's own voice costs nothing
}

// ---------- the conversation ----------

async function send(text) {
  const startedAt = performance.now();
  el.heard.textContent = text;
  const out = reply(state, text, business);
  state = out.state;
  if (out.booking) await saveBooking(out.booking);
  const spoken = await say(out.say);
  report(out, out.say.length, spoken, performance.now() - startedAt);
  return out;
}

// One content-free line per turn: what happened, how long, how many characters.
// Never what was said — see src/metrics.js.
function report(out, spokenCharacters, spoken, replyMs) {
  const body = JSON.stringify({ action: out.action, spokenCharacters, cached: !!(spoken && spoken.cached), replyMs });
  fetch('api/usage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }).catch(() => {});
}

async function saveBooking(booking) {
  try {
    await fetch('api/bookings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(booking),
    });
  } catch { /* the demo keeps going; the list just will not refresh */ }
  await loadBookings();
}

async function loadBookings() {
  try {
    const rows = await (await fetch('api/bookings')).json();
    el.bookings.innerHTML = rows.length
      ? rows.map((r) => `<li><strong>${esc(r.name)}</strong> · ${esc(r.day)} · ${esc(r.phone)}</li>`).join('')
      : '<li class="empty">None yet.</li>';
  } catch { /* leave whatever is on screen */ }
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- listening ----------

function speechSupport() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function useTypedInput(why) {
  el.typed.hidden = false;
  el.talk.disabled = true;
  el.status.textContent = why;
}

function startListening() {
  if (listening || !recognition) return;
  listening = true;
  el.talk.dataset.listening = 'true';
  el.status.textContent = 'Listening…';
  try { recognition.start(); } catch { /* already running */ }
  clearTimeout(silenceTimer);
  // Check 6: never sit there listening forever.
  silenceTimer = setTimeout(() => {
    stopListening();
    el.status.textContent = "I didn't hear anything, so I stopped listening. Hold the button and try again.";
  }, SILENCE_MS);
}

function stopListening() {
  clearTimeout(silenceTimer);
  if (!listening) return;
  listening = false;
  el.talk.dataset.listening = 'false';
  try { recognition.stop(); } catch { /* already stopped */ }
  if (el.status.textContent === 'Listening…') el.status.textContent = '';
}

function wireSpeech() {
  const Ctor = speechSupport();
  if (!Ctor) return useTypedInput('This browser has no speech recognition, so type instead. Chrome or Edge works best.');

  recognition = new Ctor();
  recognition.lang = 'en-AU';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onresult = (event) => {
    clearTimeout(silenceTimer);
    const text = event.results?.[0]?.[0]?.transcript || '';
    stopListening();
    if (text.trim()) send(text);
  };
  recognition.onerror = (event) => {
    stopListening();
    // Check 5: a refused microphone must not leave a dead page.
    if (event?.error === 'not-allowed' || event?.error === 'service-not-allowed') {
      return useTypedInput('No microphone permission, so type your question instead.');
    }
    el.status.textContent = 'I had trouble hearing that. Hold the button and try again.';
  };
  recognition.onend = () => stopListening();

  el.talk.addEventListener('pointerdown', startListening);
  el.talk.addEventListener('pointerup', stopListening);
  el.talk.addEventListener('pointerleave', stopListening);
  // Keyboard users get the same thing without a pointer.
  el.talk.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); startListening(); } });
  el.talk.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') stopListening(); });
}

el.typedForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = el.typedInput.value.trim();
  if (!text) return;
  el.typedInput.value = '';
  send(text);
});

wireSpeech();
loadBookings();

// The seam the browser test drives, so it never needs a real microphone.
window.__assistant = { send, say, get state() { return state; }, startListening, stopListening };
