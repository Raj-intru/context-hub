// Central configuration + validation.
// The server refuses to boot in production with missing or placeholder secrets,
// so a misconfigured deploy fails loudly instead of running insecurely.

const PLACEHOLDER = /^CHANGE_ME|^$/i;

function req(name, { prodOnly = false } = {}) {
  const val = process.env[name];
  const isProd = process.env.NODE_ENV === 'production';
  const missing = !val || PLACEHOLDER.test(val);
  if (missing && (isProd || !prodOnly)) {
    if (isProd) {
      throw new Error(`Missing/placeholder required env var in production: ${name}`);
    }
  }
  return val || '';
}

function parseJson(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Env var ${name} is not valid JSON`);
  }
}

const isProd = process.env.NODE_ENV === 'production';

export const config = {
  env: process.env.NODE_ENV || 'development',
  isProd,
  port: Number(process.env.PORT) || 5000,
  appBaseUrl: process.env.APP_BASE_URL || 'http://localhost:5000',

  databaseUrl: req('DATABASE_URL', { prodOnly: true }) ||
    'postgres://lyra_app:lyra_dev@localhost:5432/lyra',

  // Secrets. In production these MUST be real (validated above).
  jwtSecret: req('JWT_SECRET') || 'dev-only-insecure-jwt-secret-change-me',
  contentEncryptionKey: req('CONTENT_ENCRYPTION_KEY') ||
    // Deterministic dev key so local runs work; NEVER used in production.
    '0000000000000000000000000000000000000000000000000000000000000000',

  openRouterApiKey: process.env.OPENROUTER_API_KEY || '',
  openAiApiKey: process.env.OPENAI_API_KEY || '',
  moderationFailOpen: process.env.MODERATION_FAIL_OPEN === 'true',
  defaultModel: process.env.DEFAULT_MODEL || 'google/gemini-flash-1.5',
  // OSS <-> paid routing: cheap open-source model for simple/supervised turns,
  // a frontier paid model for complex/adult turns. Both flow through OpenRouter.
  models: {
    simple: process.env.DEFAULT_MODEL_SIMPLE || 'meta-llama/llama-3.1-8b-instruct',
    complex: process.env.DEFAULT_MODEL_COMPLEX || 'anthropic/claude-3.5-sonnet',
    // Vision-capable models chosen when a turn carries an image (e.g. a photo of
    // homework). Both defaults are real, vision-capable slugs.
    visionSimple: process.env.VISION_MODEL_SIMPLE || 'google/gemini-flash-1.5',
    visionComplex: process.env.VISION_MODEL_COMPLEX || 'anthropic/claude-3.5-sonnet',
  },
  // Extra model ids an adult client is allowed to request explicitly, beyond the
  // routed simple/complex/default trio. Comma-separated. Supervised accounts are
  // never allowed to pick a model regardless of this list.
  modelAllowlist: (process.env.MODEL_ALLOWLIST || '')
    .split(',').map((s) => s.trim()).filter(Boolean),
  // Image GENERATION is off by default (never enabled for minors regardless).
  allowImageGeneration: process.env.ALLOW_IMAGE_GENERATION === 'true',
  // Max image attachments accepted on a single chat turn.
  maxAttachments: Number(process.env.MAX_ATTACHMENTS) || 4,
  // The AI gateway ("universal key"): one virtual key -> real provider keys.
  gateway: {
    baseUrl: process.env.LYRA_GATEWAY_BASE_URL || 'https://openrouter.ai/api/v1',
    apiKey: process.env.LYRA_GATEWAY_API_KEY || process.env.OPENROUTER_API_KEY || '',
    // Per-tenant BYOK: tenantId -> { baseUrl, apiKey }. Env is a stopgap; use a
    // secret manager in production (see docs/DEPLOY.md).
    tenantGateways: parseJson('LYRA_TENANT_GATEWAYS', {}),
  },

  // Which product this deployment is (drives branding/roles/platforms).
  product: process.env.PRODUCT === 'school' ? 'school' : (process.env.PRODUCT === 'family' ? 'family' : 'both'),
  // Shared secret Vercel Cron (or your scheduler) must present to run cron routes.
  cronSecret: process.env.CRON_SECRET || '',

  stripeSecretKey: process.env.STRIPE_SECRET_KEY || '',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  stripePriceQuotas: parseJson('STRIPE_PRICE_QUOTAS', {}),

  email: {
    provider: process.env.EMAIL_PROVIDER || '',
    apiKey: process.env.EMAIL_API_KEY || '',
    from: process.env.EMAIL_FROM || 'Lyra <no-reply@example.com>',
  },
  enableWeeklyDigest: process.env.ENABLE_WEEKLY_DIGEST === 'true',

  // Session token lifetime.
  sessionTtlSeconds: 60 * 60 * 12, // 12h
};

// Fail fast on obviously-insecure production config.
if (isProd) {
  if (config.contentEncryptionKey.length !== 64) {
    throw new Error('CONTENT_ENCRYPTION_KEY must be 64 hex chars (32 bytes) in production');
  }
  if (config.contentEncryptionKey === '0'.repeat(64)) {
    throw new Error('CONTENT_ENCRYPTION_KEY is the dev placeholder; set a real key');
  }
  if (config.jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 chars in production');
  }
}

export default config;
