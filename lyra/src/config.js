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
