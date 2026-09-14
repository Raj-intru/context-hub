// Model registry — the single source of truth for what each model can do.
//
// Lyra routes across open-source and paid models through one gateway (see
// gateway.js). Routing decisions (router.js) and safety gates (chat route) need
// to know, per model: its cost tier, which input modalities it supports, and
// whether it is safe to put in front of a supervised minor. Rather than scatter
// that knowledge, it lives here as data.
//
// Modalities:
//   text   — text in / text out (every model)
//   vision — accepts image inputs (photos of homework, diagrams, worksheets)
//   image  — GENERATES images (off by default for minors; see config)
//
// `supervisedSafe` marks models we're willing to route a child/student to. A
// model can be capable but not supervised-safe (e.g. an image generator).
//
// Ids are gateway model slugs. The OpenRouter defaults below are real,
// vision-capable slugs; an operator can point the routing config at any id in
// (or added to) this registry.

export const MODELS = {
  // --- Cheap / fast, text-only (default "simple" tier) ---
  'meta-llama/llama-3.1-8b-instruct': {
    provider: 'meta', tier: 'simple', modalities: ['text'], supervisedSafe: true,
    note: 'Cheap OSS default for supervised/simple text turns.',
  },

  // --- Cheap / fast, WITH vision (homework photos, worksheets, diagrams) ---
  'google/gemini-flash-1.5': {
    provider: 'google', tier: 'simple', modalities: ['text', 'vision'], supervisedSafe: true,
    note: 'Low-cost multimodal; good default for image-bearing student turns.',
  },
  'qwen/qwen-2-vl-7b-instruct': {
    provider: 'qwen', tier: 'simple', modalities: ['text', 'vision'], supervisedSafe: true,
    note: 'Open-source vision/OCR — strong on photographed text and worksheets.',
  },
  'meta-llama/llama-3.2-11b-vision-instruct': {
    provider: 'meta', tier: 'simple', modalities: ['text', 'vision'], supervisedSafe: true,
    note: 'Open-source vision model; self-hostable for data-residency needs.',
  },

  // --- Frontier / paid, WITH vision (default "complex" tier) ---
  'anthropic/claude-3.5-sonnet': {
    provider: 'anthropic', tier: 'complex', modalities: ['text', 'vision'], supervisedSafe: true,
    note: 'Frontier reasoning + vision for complex adult turns.',
  },
  'openai/gpt-4o': {
    provider: 'openai', tier: 'complex', modalities: ['text', 'vision'], supervisedSafe: true,
    note: 'Frontier multimodal alternative.',
  },

  // --- Image GENERATION (never supervised-safe; off by default) ---
  'openai/gpt-image-1': {
    provider: 'openai', tier: 'complex', modalities: ['image'], supervisedSafe: false,
    note: 'Image generation. Disabled for minors; gated by config.allowImageGeneration.',
  },
};

export function getModel(id) {
  return MODELS[id] || null;
}

/** Does this model accept/produce the given modality? Unknown ids => text-only. */
export function supportsModality(id, modality) {
  const m = MODELS[id];
  if (!m) return modality === 'text'; // conservative: assume text-only
  return m.modalities.includes(modality);
}

export function isSupervisedSafe(id) {
  // Unknown ids are treated as NOT supervised-safe (fail closed for minors).
  return !!MODELS[id]?.supervisedSafe;
}

export function isImageGenerationModel(id) {
  return !!MODELS[id]?.modalities.includes('image')
    && !MODELS[id]?.modalities.includes('vision')
    && !MODELS[id]?.modalities.includes('text');
}
