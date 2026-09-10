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
}

$('#invite-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    const res = await api('/invites', { method: 'POST', body: {
      email: f.get('email') || undefined, firstName: f.get('firstName') || undefined, role: f.get('role'),
    } });
    $('#invite-result').innerHTML = `Invite created. Share this link:<code>${escapeHtml(res.acceptUrl)}</code>`;
    e.target.reset();
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
