// Model routing: pick an open-source vs frontier-paid model per request.
// Both flow through OpenRouter, so this is a pure cost/quality policy — the
// margin lever from the product brief. An explicit client choice always wins.
//
//   supervised (child/student)        -> simple OSS model (cheap, fast, safe)
//   short / simple adult prompt       -> simple OSS model
//   long / complex adult prompt       -> frontier paid model
//
// "Complex" is a cheap heuristic (length + reasoning cues); swap for a learned
// classifier later without changing callers.

import config from '../config.js';

const COMPLEX_CUES = /\b(analy[sz]e|compare|contrast|evaluate|design|architect|prove|derive|debug|optimi[sz]e|trade[- ]?off|strategy|why|explain in detail)\b/i;

/**
 * @returns {{ model: string, tier: 'client'|'simple'|'complex' }}
 */
export function chooseModel({ role, prompt = '', requestedModel = null, supervised = null }) {
  if (requestedModel) return { model: requestedModel, tier: 'client' };

  const isSupervised = supervised ?? ['child', 'student'].includes(role);
  if (isSupervised) return { model: config.models.simple, tier: 'simple' };

  const words = prompt.trim().split(/\s+/).filter(Boolean).length;
  const complex = words > 60 || COMPLEX_CUES.test(prompt);
  return complex
    ? { model: config.models.complex, tier: 'complex' }
    : { model: config.models.simple, tier: 'simple' };
}
