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

// Moderate IMAGE inputs (e.g. a photo a student attaches). omni-moderation is
// multimodal, so we send image_url parts. Same fail-closed contract as text:
// if moderation is unavailable, a supervised image is BLOCKED by default. The
// caller passes the same images it would send to the model.
export async function moderateImages(images, {
  fetchImpl = fetch,
  apiKey = config.openAiApiKey,
  failOpen = config.moderationFailOpen,
} = {}) {
  const urls = (Array.isArray(images) ? images : []).map((i) => i && i.url).filter(Boolean);
  if (!urls.length) return { available: true, flagged: false, reason: 'no_images', categories: {} };
  if (!apiKey) {
    return {
      available: false,
      flagged: !failOpen,
      reason: failOpen ? 'moderation_disabled_fail_open' : 'moderation_unavailable',
      categories: {},
    };
  }

  try {
    const resp = await fetchImpl('https://api.openai.com/v1/moderations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'omni-moderation-latest',
        input: urls.map((url) => ({ type: 'image_url', image_url: { url } })),
      }),
    });
    if (!resp.ok) {
      return { available: false, flagged: !failOpen, reason: `moderation_http_${resp.status}`, categories: {} };
    }
    const data = await resp.json();
    const results = data?.results;
    if (!Array.isArray(results) || !results.length) {
      return { available: false, flagged: !failOpen, reason: 'moderation_empty', categories: {} };
    }
    // Flag the batch if ANY image trips the filter.
    const flaggedResult = results.find((r) => r?.flagged);
    return {
      available: true,
      flagged: !!flaggedResult,
      reason: flaggedResult ? 'flagged' : 'ok',
      categories: flaggedResult?.categories || {},
    };
  } catch (err) {
    return { available: false, flagged: !failOpen, reason: `moderation_error:${err.message}`, categories: {} };
  }
}
