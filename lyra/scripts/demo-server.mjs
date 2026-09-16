// Demo launcher: runs the REAL Lyra app against the local Postgres, but stubs
// the external AI provider + moderation so it works without live API keys.
// The stub returns a plausible Socratic-style reply so the UI can be seen
// end-to-end. NOT for production — real deploys use real provider keys.

process.env.NODE_ENV = process.env.NODE_ENV || 'development';
process.env.OPENROUTER_API_KEY = 'demo';
process.env.OPENAI_API_KEY = 'demo';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'demo-jwt-secret-at-least-32-characters-long!!';
process.env.CONTENT_ENCRYPTION_KEY = process.env.CONTENT_ENCRYPTION_KEY || '22'.repeat(32);
process.env.PORT = process.env.PORT || '5050';

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.includes('api.openai.com/v1/moderations')) {
    const body = JSON.parse(opts.body || '{}');
    const flagged = /\b(kill|weapon|BADWORD)\b/i.test(body.input || '');
    return new Response(JSON.stringify({ results: [{ flagged, categories: {} }] }), { status: 200 });
  }
  if (u.includes('openrouter.ai')) {
    const body = JSON.parse(opts.body || '{}');
    const isSocratic = (body.messages || []).some((m) => m.role === 'system' && /Socratic/i.test(m.content || ''));
    const lastUser = [...(body.messages || [])].reverse().find((m) => m.role === 'user')?.content || '';
    const reply = isSocratic
      ? `Great question! Let's work through "${lastUser.slice(0, 60)}" together instead of me just giving the answer. 🌱\n\n`
        + `First, what do you already know about this? For example:\n`
        + `1. Can you name the parts of the problem?\n`
        + `2. What do you think the very first step might be?\n\n`
        + `Tell me your idea for step 1 and we'll build from there!`
      : `Here's a concise answer to "${lastUser.slice(0, 60)}":\n\nThis is a demo response from Lyra's stubbed provider. In production this call goes to OpenRouter and returns a real model completion.`;
    return new Response(JSON.stringify({
      model: body.model || 'demo/model',
      choices: [{ message: { content: reply } }],
      usage: { total_tokens: 128 },
    }), { status: 200 });
  }
  if (u.includes('127.0.0.1') || u.includes('localhost')) return realFetch(url, opts);
  throw new Error(`demo: blocked external fetch ${u}`);
};

await import('../src/server.js');
