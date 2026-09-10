// OpenRouter chat-completions proxy with defensive parsing.
//
// The uploaded blueprint did `aiData.choices[0].message.content` directly,
// which throws on ANY provider error (rate limit, bad model, outage) and
// surfaces as a generic 500. Here we validate the shape and return a typed
// result the route can turn into a clean client error.
//
// `fetchImpl` is injectable for tests.

import config from '../config.js';

export class LlmError extends Error {
  constructor(message, { status = 502, code = 'LLM_ERROR' } = {}) {
    super(message);
    this.name = 'LlmError';
    this.status = status;
    this.code = code;
  }
}

export async function complete({ model, messages, fetchImpl = fetch, apiKey = config.openRouterApiKey }) {
  if (!apiKey) {
    throw new LlmError('AI provider is not configured', { status: 503, code: 'LLM_NOT_CONFIGURED' });
  }

  let resp;
  try {
    resp = await fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': config.appBaseUrl,
        'X-Title': 'Lyra',
      },
      body: JSON.stringify({
        model: model || config.defaultModel,
        messages,
        // Prefer providers/routes that support prompt caching (cost control
        // for shared documents), and allow fallbacks for reliability.
        provider: { allow_fallbacks: true },
      }),
    });
  } catch (err) {
    throw new LlmError(`Upstream request failed: ${err.message}`, { status: 502 });
  }

  let data;
  try {
    data = await resp.json();
  } catch {
    throw new LlmError('Upstream returned a non-JSON response', { status: 502 });
  }

  if (!resp.ok) {
    const msg = data?.error?.message || `Upstream error ${resp.status}`;
    // Pass through rate limiting so callers can back off.
    const status = resp.status === 429 ? 429 : 502;
    throw new LlmError(msg, { status, code: 'LLM_UPSTREAM' });
  }

  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new LlmError('Upstream response missing message content', { status: 502 });
  }

  const tokensUsed = Number(data?.usage?.total_tokens) || 0;
  const modelUsed = data?.model || model || config.defaultModel;
  return { content, tokensUsed, modelUsed };
}
