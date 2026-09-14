// Model routing: pick an open-source vs frontier-paid model per request.
// Both flow through OpenRouter, so this is a pure cost/quality policy — the
// margin lever from the product brief.
//
//   supervised (child/student)        -> LOCKED to the simple OSS model
//   short / simple adult prompt       -> simple OSS model
//   long / complex adult prompt       -> frontier paid model
//
// Safety: a supervised account can NEVER be routed to a client-requested model.
// A client could otherwise ask for an expensive or less-guardrailed model on a
// child's behalf; we ignore requestedModel entirely for supervised users. Adults
// may request a specific model, but only one on the allowlist — an arbitrary
// string is rejected back to auto-routing so we never proxy to an unknown
// upstream model id.
//
// "Complex" is a cheap heuristic (length + reasoning cues); swap for a learned
// classifier later without changing callers.

import config from '../config.js';

const COMPLEX_CUES = /\b(analy[sz]e|compare|contrast|evaluate|design|architect|prove|derive|debug|optimi[sz]e|trade[- ]?off|strategy|why|explain in detail)\b/i;

/** The set of model ids an adult client is permitted to request explicitly. */
export function allowedModels() {
  return new Set([
    config.models.simple,
    config.models.complex,
    config.defaultModel,
    ...config.modelAllowlist,
  ].filter(Boolean));
}

export function isModelAllowed(model) {
  return allowedModels().has(model);
}

/**
 * @returns {{ model: string, tier: 'supervised'|'client'|'simple'|'complex', locked?: boolean }}
 */
export function chooseModel({ role, prompt = '', requestedModel = null, supervised = null }) {
  const isSupervised = supervised ?? ['child', 'student'].includes(role);

  // Supervised accounts are locked to the routed (safe, cheap) model. Any
  // client-requested model is ignored.
  if (isSupervised) {
    return { model: config.models.simple, tier: 'supervised', locked: true };
  }

  // Adults may pin a specific model, but only from the allowlist. An
  // unrecognized id falls through to auto-routing rather than being proxied.
  if (requestedModel && isModelAllowed(requestedModel)) {
    return { model: requestedModel, tier: 'client' };
  }

  const words = prompt.trim().split(/\s+/).filter(Boolean).length;
  const complex = words > 60 || COMPLEX_CUES.test(prompt);
  return complex
    ? { model: config.models.complex, tier: 'complex' }
    : { model: config.models.simple, tier: 'simple' };
}
