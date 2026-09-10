// Content moderation for supervised (child/student) accounts.
//
// Uses OpenAI's moderation endpoint. Critically, this "fails closed" for
// supervised users by default: if moderation is unavailable, the request is
// BLOCKED rather than sent unfiltered to the model. Set MODERATION_FAIL_OPEN=
// true only if you accept the risk. Adults are never gated here.
//
// `fetchImpl` is injectable so this is unit-testable without network.

import config from '../config.js';

export async function moderate(promptText, {
  fetchImpl = fetch,
  apiKey = config.openAiApiKey,
  failOpen = config.moderationFailOpen,
} = {}) {
  if (!apiKey) {
    return {
      available: false,
      flagged: !failOpen, // fail closed unless configured otherwise
      reason: failOpen ? 'moderation_disabled_fail_open' : 'moderation_unavailable',
      categories: {},
    };
  }

  try {
    const resp = await fetchImpl('https://api.openai.com/v1/moderations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: 'omni-moderation-latest', input: String(promptText) }),
    });

    if (!resp.ok) {
      return {
        available: false,
        flagged: !failOpen,
        reason: `moderation_http_${resp.status}`,
        categories: {},
      };
    }

    const data = await resp.json();
    const result = data?.results?.[0];
    if (!result) {
      return { available: false, flagged: !failOpen, reason: 'moderation_empty', categories: {} };
    }
    return {
      available: true,
      flagged: !!result.flagged,
      reason: result.flagged ? 'flagged' : 'ok',
      categories: result.categories || {},
    };
  } catch (err) {
    return {
      available: false,
      flagged: !failOpen,
      reason: `moderation_error:${err.message}`,
      categories: {},
    };
  }
}
