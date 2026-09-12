// Lyra web client — dependency-free ES module.

const ADMIN_ROLES = ['parent_admin', 'it_admin', 'teacher'];
const ROLE_OPTIONS = {
  family: [['child', 'Child (Socratic tutor)'], ['adult', 'Adult'], ['parent_admin', 'Parent admin']],
  school: [['student', 'Student (Socratic tutor)'], ['teacher', 'Teacher'], ['it_admin', 'IT admin']],
};

const state = { token: localStorage.getItem('lyra_token') || null, user: null, conversationId: null };

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch(`/api${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message || data.error || `HTTP ${res.status}`), { code: data.error, status: res.status });
  return data;
}

function setMsg(el, text, kind = '') { const n = $(el); n.textContent = text; n.className = `msg ${kind}`; }
function isAdmin() { return state.user && ADMIN_ROLES.includes(state.user.role); }

// ---- Appearance (per-user theme + accent) ----
const ACCENTS = { indigo: '#4f46e5', violet: '#7c3aed', sky: '#0284c7', teal: '#0d9488',
  emerald: '#059669', rose: '#e11d48', amber: '#d97706', slate: '#475569' };

function applyAppearance(theme, accent) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
  else root.removeAttribute('data-theme'); // system
  root.style.setProperty('--brand', ACCENTS[accent] || ACCENTS.indigo);
  try { localStorage.setItem('lyra_theme', theme); localStorage.setItem('lyra_accent', accent); } catch { /* private mode */ }
  state.theme = theme; state.accent = accent;
}
// Apply any locally-remembered choice immediately, so there's no flash pre-login.
try { applyAppearance(localStorage.getItem('lyra_theme') || 'system', localStorage.getItem('lyra_accent') || 'indigo'); } catch { /* ignore */ }

async function initAppearance() {
  let opts;
  try { opts = await api('/me/appearance-options'); }
  catch { opts = { theme: state.theme, accent: state.accent, accents: Object.entries(ACCENTS).map(([name, hex]) => ({ name, hex })) }; }
  applyAppearance(opts.theme, opts.accent);
  // Theme toggle
  $$('#theme-toggle button').forEach((b) => {
    b.classList.toggle('on', b.dataset.theme === state.theme);
    b.onclick = () => { applyAppearance(b.dataset.theme, state.accent); refreshAppearanceUI(); persistPref({ theme: b.dataset.theme }); };
  });
  // Accent swatches (role-gated set comes from the server)
  const grid = $('#swatches'); grid.innerHTML = '';
  opts.accents.forEach(({ name, hex }) => {
    const s = document.createElement('button');
    s.className = 'swatch'; s.style.background = hex; s.title = name;
    s.onclick = () => { applyAppearance(state.theme, name); refreshAppearanceUI(); persistPref({ accent: name }); };
    grid.appendChild(s);
  });
  refreshAppearanceUI();
}
function refreshAppearanceUI() {
  $$('#theme-toggle button').forEach((b) => b.classList.toggle('on', b.dataset.theme === state.theme));
  $$('#swatches .swatch').forEach((s) => s.classList.toggle('on', s.title === state.accent));
}
async function persistPref(patch) { try { await api('/me/preferences', { method: 'PATCH', body: patch }); } catch { /* keep local */ } }

$('#appearance-btn').addEventListener('click', (e) => { e.stopPropagation(); $('#appearance-menu').hidden = !$('#appearance-menu').hidden; });
$('#appearance-menu').addEventListener('click', (e) => e.stopPropagation());
document.addEventListener('click', () => { const m = $('#appearance-menu'); if (m) m.hidden = true; });

function showView(view) {
  $$('.view').forEach((v) => (v.hidden = true));
  $(`#view-${view}`).hidden = false;
  $$('#nav .navbtn[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  if (view === 'chat') loadConversations();
  if (view === 'badges') loadBadges();
  if (view === 'dashboard') loadDashboard();
}

function afterLogin(result) {
  state.token = result.token; state.user = result.user;
  localStorage.setItem('lyra_token', state.token);
  $('#nav').hidden = false;
  $('#whoami').textContent = `${result.user.firstName || result.user.email || 'You'} · ${result.user.role}`;
  $$('.admin-only').forEach((el) => (el.hidden = !isAdmin()));
  // Apply the user's saved appearance and build the (role-gated) picker.
  if (result.user.theme || result.user.accent) applyAppearance(result.user.theme || state.theme, result.user.accent || state.accent);
  initAppearance();
  showView('chat');
}

function logout() {
  state.token = null; state.user = null; localStorage.removeItem('lyra_token');
  $('#nav').hidden = true;
  $$('.view').forEach((v) => (v.hidden = true));
  $('#view-auth').hidden = false;
}

// ---- Auth ----
$$('.tab').forEach((t) => t.addEventListener('click', () => {
  $$('.tab').forEach((x) => x.classList.remove('active')); t.classList.add('active');
  ['login', 'signup', 'invite'].forEach((f) => ($(`#form-${f}`).hidden = f !== t.dataset.tab));
  setMsg('#auth-msg', '');
}));

$('#form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  try { afterLogin(await api('/auth/login', { method: 'POST', body: { email: f.get('email'), password: f.get('password') } })); }
  catch (err) { setMsg('#auth-msg', err.message, 'error'); }
});

$('#form-signup').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    afterLogin(await api('/auth/signup', { method: 'POST', body: {
      tenantType: f.get('tenantType'), tenantName: f.get('tenantName'),
      firstName: f.get('firstName'), email: f.get('email'), password: f.get('password'),
    } }));
  } catch (err) { setMsg('#auth-msg', err.message, 'error'); }
});

$('#form-invite').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    afterLogin(await api('/auth/accept-invite', { method: 'POST', body: {
      token: f.get('token').trim(), firstName: f.get('firstName'), password: f.get('password'),
    } }));
  } catch (err) { setMsg('#auth-msg', err.message, 'error'); }
});

$('#logout').addEventListener('click', logout);
$$('#nav .navbtn[data-view]').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));

// ---- Chat ----
async function loadConversations() {
  try {
    const { conversations } = await api('/conversations');
    const list = $('#convo-list'); list.innerHTML = '';
    conversations.forEach((c) => {
      const li = document.createElement('li');
      li.textContent = c.title || 'Chat';
      li.classList.toggle('active', c.id === state.conversationId);
      li.addEventListener('click', () => openConversation(c.id));
      list.appendChild(li);
    });
  } catch { /* not fatal */ }
}

async function openConversation(id) {
  state.conversationId = id;
  const { messages } = await api(`/conversations/${id}/messages`);
  const box = $('#messages'); box.innerHTML = '';
  messages.forEach((m) => addBubble(m.role, m.content));
  loadConversations();
}

function addBubble(role, text) {
  const div = document.createElement('div');
  div.className = `bubble ${role === 'assistant' ? 'assistant' : 'user'}`;
  div.textContent = text;
  $('#messages').appendChild(div);
  $('#messages').scrollTop = $('#messages').scrollHeight;
}

$('#new-chat').addEventListener('click', () => { state.conversationId = null; $('#messages').innerHTML = ''; setMsg('#chat-msg', ''); });

$('#chat-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const prompt = $('#prompt').value.trim();
  if (!prompt) return;
  const btn = e.target.querySelector('button');
  addBubble('user', prompt); $('#prompt').value = ''; btn.disabled = true; setMsg('#chat-msg', 'Thinking…');
  try {
    const res = await api('/chat', { method: 'POST', body: {
      prompt, model: $('#model-select').value, conversationId: state.conversationId,
    } });
    state.conversationId = res.conversationId;
    addBubble('assistant', res.reply);
    setMsg('#chat-msg', `${res.tokensUsed} tokens · ${res.model}`, 'ok');
    loadConversations();
  } catch (err) {
    setMsg('#chat-msg', err.message, 'error');
  } finally { btn.disabled = false; }
});

// ---- Badges ----
async function loadBadges() {
  const { badges } = await api('/badges/me');
  const grid = $('#badge-grid'); grid.innerHTML = '';
  badges.forEach((b) => {
    const div = document.createElement('div');
    div.className = `badge ${b.earned ? '' : 'locked'}`;
    div.innerHTML = `<div class="emoji">${b.icon_emoji}</div><div class="title">${escapeHtml(b.title)}</div><div class="desc">${escapeHtml(b.description || '')}</div>`;
    grid.appendChild(div);
  });
}

// ---- Dashboard ----
async function loadDashboard() {
  const data = await api('/dashboard');
  const t = data.tenant;
  const used = Number(t.tokens_consumed_this_period), limit = Number(t.token_pool_limit);
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  $('#pool-summary').innerHTML = `
    <div class="stat"><div class="k">Workspace</div><div class="v">${escapeHtml(t.name)}</div></div>
    <div class="stat"><div class="k">Plan</div><div class="v">${escapeHtml(t.plan_type)}</div></div>
    <div class="stat"><div class="k">Tokens used</div><div class="v">${used.toLocaleString()} / ${limit.toLocaleString()} (${pct}%)</div></div>`;

  const rows = data.members.map((m) => `<tr>
      <td>${escapeHtml(m.first_name || '—')}</td>
      <td>${escapeHtml(m.role)}</td>
      <td>${Number(m.requests_this_period)}</td>
      <td>${Number(m.tokens_this_period).toLocaleString()}</td>
      <td>${Number(m.flagged_this_period) ? '⚠️ ' + m.flagged_this_period : '—'}</td>
      <td>${m.is_active ? 'active' : 'paused'}</td>
    </tr>`).join('');
  $('#members-table').innerHTML = `<thead><tr><th>Name</th><th>Role</th><th>Sessions</th><th>Tokens</th><th>Flagged</th><th>Status</th></tr></thead><tbody>${rows}</tbody>`;

  const roleSel = $('#invite-role'); roleSel.innerHTML = '';
  (ROLE_OPTIONS[t.type] || []).forEach(([val, label]) => {
    const o = document.createElement('option'); o.value = val; o.textContent = label; roleSel.appendChild(o);
  });

  // Load the consent wording once; show the acknowledgement only for minors.
  if (!state.consent) {
    try { state.consent = await api('/consent-text'); } catch { state.consent = null; }
  }
  if (state.consent) $('#consent-text').textContent = state.consent.text;
  updateConsentVisibility();

  await loadContextCard(data.members);
}

const SUPERVISED_ROLES = ['child', 'student'];

// ---- Learning context (parents/teachers choose a child's grounding) ----
async function loadContextCard(members) {
  const kids = (members || []).filter((m) => SUPERVISED_ROLES.includes(m.role));
  const card = $('#ctx-card');
  card.hidden = kids.length === 0;
  if (!kids.length) return;

  if (!state.scopes) { try { state.scopes = (await api('/scopes')).scopes; } catch { state.scopes = []; } }
  $('#ctx-scopes').innerHTML = state.scopes.map((s) => `
    <label><input type="checkbox" value="${escapeHtml(s.scope_key)}" />
      <span class="subj">${escapeHtml(s.subject || s.scope_key)}</span>
      <span class="yr">${escapeHtml(s.year_level || '')}</span></label>`).join('')
    || '<span class="yr">No curriculum packs available yet.</span>';

  const sel = $('#ctx-child'); sel.innerHTML = '';
  kids.forEach((k) => { const o = document.createElement('option'); o.value = k.user_id; o.textContent = `${k.first_name || '—'} · ${k.role}`; sel.appendChild(o); });
  sel.onchange = loadChildContext;
  await loadChildContext();
}
async function loadChildContext() {
  const id = $('#ctx-child').value; if (!id) return;
  setMsg('#ctx-msg', '');
  try {
    const { context } = await api(`/children/${id}/context`);
    $('#ctx-year').value = context.year_level || '';
    const chosen = new Set(context.scope_keys || []);
    $$('#ctx-scopes input').forEach((cb) => (cb.checked = chosen.has(cb.value)));
  } catch (e) { setMsg('#ctx-msg', e.message, 'error'); }
}
$('#ctx-save').addEventListener('click', async () => {
  const id = $('#ctx-child').value; if (!id) return;
  const scopeKeys = $$('#ctx-scopes input:checked').map((cb) => cb.value);
  try {
    await api(`/children/${id}/context`, { method: 'PUT', body: { yearLevel: $('#ctx-year').value || null, scopeKeys } });
    setMsg('#ctx-msg', 'Saved — the tutor will use only these materials for this child.', 'ok');
  } catch (e) { setMsg('#ctx-msg', e.message, 'error'); }
});
function updateConsentVisibility() {
  const role = $('#invite-role').value;
  const show = SUPERVISED_ROLES.includes(role);
  $('#consent-block').hidden = !show;
  if (!show) $('#consent-check').checked = false;
}
$('#invite-role').addEventListener('change', updateConsentVisibility);

$('#invite-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const role = f.get('role');
  const minor = SUPERVISED_ROLES.includes(role);
  if (minor && !$('#consent-check').checked) {
    $('#invite-result').textContent = 'Please acknowledge consent to provision a minor account.';
    return;
  }
  try {
    const res = await api('/invites', { method: 'POST', body: {
      email: f.get('email') || undefined, firstName: f.get('firstName') || undefined, role,
      ...(minor ? { consentAcknowledged: true, consentVersion: state.consent?.version } : {}),
    } });
    $('#invite-result').innerHTML = `Invite created. Share this link:<code>${escapeHtml(res.acceptUrl)}</code>`;
    e.target.reset();
    updateConsentVisibility();
  } catch (err) { $('#invite-result').textContent = err.message; }
});

function escapeHtml(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// ---- Boot ----
(async function boot() {
  // Prefill invite token from ?token= (accept-invite link).
  const params = new URLSearchParams(location.search);
  if (params.get('token')) {
    $$('.tab').forEach((x) => x.classList.remove('active'));
    document.querySelector('.tab[data-tab="invite"]').classList.add('active');
    ['login', 'signup', 'invite'].forEach((fm) => ($(`#form-${fm}`).hidden = fm !== 'invite'));
    $('#form-invite').elements.token.value = params.get('token');
  }
  if (state.token) {
    try { afterLogin({ token: state.token, user: (await api('/auth/me')).user }); }
    catch { logout(); }
  }
})();
