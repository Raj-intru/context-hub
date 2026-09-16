// Pluggable outbound email. Defaults to a no-op that logs, so the app runs
// without an email provider. Set EMAIL_PROVIDER=resend + EMAIL_API_KEY to send.

import config from '../config.js';

export async function sendEmail({ to, subject, html, fetchImpl = fetch }) {
  if (!to) throw new Error('sendEmail requires a recipient');
  if (config.email.provider !== 'resend' || !config.email.apiKey) {
    console.log(`[email:noop] would send "${subject}" to ${to}`);
    return { sent: false, reason: 'email_disabled' };
  }
  const resp = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.email.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: config.email.from, to, subject, html }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    console.error('[email] send failed', resp.status, body);
    return { sent: false, reason: `http_${resp.status}` };
  }
  return { sent: true };
}
