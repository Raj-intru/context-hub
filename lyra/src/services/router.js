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
import { supportsModality } from './models.js';

const COMPLEX_CUES = /\b(analy[sz]e|compare|contrast|evaluate|design|architect|prove|derive|debug|optimi[sz]e|trade[- ]?off|strategy|why|explain in detail)\b/i;

/** The set of model ids an adult client is permitted to request explicitly. */
export function allowedModels() {
  return new Set([
    config.models.simple,
    config.models.complex,
    config.models.visionSimple,
    config.models.visionComplex,
    config.defaultModel,
    ...config.modelAllowlist,
  ].filter(Boolean));
}

export function isModelAllowed(model) {
  return allowedModels().has(model);
}

/**
 * Pick a model for a request, honouring modality (text vs vision) and safety.
 * @param {object} opts
 * @param {boolean} [opts.needsVision]  the turn carries an image attachment
 * @returns {{ model: string, tier: 'supervised'|'client'|'simple'|'complex', modality: 'text'|'vision', locked?: boolean }}
 */
export function chooseModel({ role, prompt = '', requestedModel = null, supervised = null, needsVision = false }) {
  const isSupervised = supervised ?? ['child', 'student'].includes(role);
  const modality = needsVision ? 'vision' : 'text';

  // Supervised accounts are locked to the routed (safe, cheap) model — a
  // vision-capable one when an image is present. Client model choice is ignored.
  if (isSupervised) {
    const model = needsVision ? config.models.visionSimple : config.models.simple;
    return { model, tier: 'supervised', modality, locked: true };
  }

  // Adults may pin a specific model from the allowlist — but only if it supports
  // the required modality. Otherwise fall through to auto-routing.
  if (requestedModel && isModelAllowed(requestedModel)
      && (!needsVision || supportsModality(requestedModel, 'vision'))) {
    return { model: requestedModel, tier: 'client', modality };
  }

  const words = prompt.trim().split(/\s+/).filter(Boolean).length;
  const complex = words > 60 || COMPLEX_CUES.test(prompt);
  if (needsVision) {
    return complex
      ? { model: config.models.visionComplex, tier: 'complex', modality }
      : { model: config.models.visionSimple, tier: 'simple', modality };
  }
  return complex
    ? { model: config.models.complex, tier: 'complex', modality }
    : { model: config.models.simple, tier: 'simple', modality };
}
