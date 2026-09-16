// Weekly usage digest for admins (parents / teachers). Uses ONLY content-free
// aggregates from usage_events — the email never contains chat text.

import { pool } from '../db.js';
import { sendEmail } from './email.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export async function weeklyMemberRows(tenantId) {
  const { rows } = await pool.query(
    `SELECT u.first_name, u.role,
            COALESCE(SUM(e.tokens_used) FILTER (WHERE e.created_at >= NOW() - INTERVAL '7 days'), 0)::bigint AS tokens_week,
            COUNT(e.id) FILTER (WHERE e.created_at >= NOW() - INTERVAL '7 days' AND e.tokens_used > 0) AS requests_week
       FROM users u
       LEFT JOIN usage_events e ON e.user_id = u.id
      WHERE u.tenant_id = $1
      GROUP BY u.id
      ORDER BY tokens_week DESC`,
    [tenantId],
  );
  return rows;
}

export function compileDigestHtml(tenantName, rows) {
  const totalTokens = rows.reduce((a, r) => a + Number(r.tokens_week), 0);
  const totalReq = rows.reduce((a, r) => a + Number(r.requests_week), 0);
  const memberRows = rows.map((r) => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #eee;font-weight:600;">${esc(r.first_name || '—')}</td>
      <td style="padding:10px 0;border-bottom:1px solid #eee;color:#555;">${esc(r.role)}</td>
      <td style="padding:10px 0;border-bottom:1px solid #eee;text-align:right;">${Number(r.requests_week)}</td>
      <td style="padding:10px 0;border-bottom:1px solid #eee;text-align:right;color:#2563eb;">${Number(r.tokens_week).toLocaleString()}</td>
    </tr>`).join('');

  return `<!doctype html><html><body style="font-family:system-ui,-apple-system,sans-serif;background:#f6f7f9;margin:0;padding:24px;">
    <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:28px;">
      <p style="font-size:12px;font-weight:700;color:#2563eb;text-transform:uppercase;letter-spacing:.05em;margin:0 0 4px;">Weekly digest</p>
      <h1 style="font-size:20px;margin:0 0 20px;color:#111;">${esc(tenantName)} · Lyra usage</h1>
      <div style="display:flex;gap:16px;margin-bottom:20px;">
        <div style="flex:1;background:#f8fafc;border-radius:10px;padding:14px;">
          <div style="font-size:11px;color:#64748b;text-transform:uppercase;">Sessions</div>
          <div style="font-size:22px;font-weight:700;">${totalReq}</div>
        </div>
        <div style="flex:1;background:#f8fafc;border-radius:10px;padding:14px;">
          <div style="font-size:11px;color:#64748b;text-transform:uppercase;">Tokens</div>
          <div style="font-size:22px;font-weight:700;color:#2563eb;">${totalTokens.toLocaleString()}</div>
        </div>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead><tr style="text-align:left;color:#9ca3af;font-size:11px;text-transform:uppercase;">
          <th style="padding-bottom:6px;">Member</th><th style="padding-bottom:6px;">Role</th>
          <th style="padding-bottom:6px;text-align:right;">Sessions</th><th style="padding-bottom:6px;text-align:right;">Tokens</th>
        </tr></thead>
        <tbody>${memberRows}</tbody>
      </table>
      <p style="margin-top:20px;font-size:12px;color:#1e40af;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:12px;">
        🔒 Individual conversations are encrypted and private to each member. This summary shows totals only.
      </p>
    </div></body></html>`;
}

// Send the digest to every admin recipient of every tenant.
export async function runWeeklyDigest() {
  const tenants = await pool.query('SELECT id, name FROM tenants');
  let sent = 0;
  for (const t of tenants.rows) {
    const admins = await pool.query(
      `SELECT email, first_name FROM users
        WHERE tenant_id = $1 AND role IN ('parent_admin','it_admin') AND email IS NOT NULL AND is_active`,
      [t.id],
    );
    if (!admins.rows.length) continue;
    const rows = await weeklyMemberRows(t.id);
    const html = compileDigestHtml(t.name, rows);
    for (const a of admins.rows) {
      const r = await sendEmail({ to: a.email, subject: 'Your weekly Lyra usage digest 📊', html });
      if (r.sent) sent += 1;
    }
  }
  console.log(`[digest] weekly run complete; emails sent: ${sent}`);
  return { sent };
}
