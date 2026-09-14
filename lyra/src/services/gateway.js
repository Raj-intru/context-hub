// AI gateway — the "universal key" seam.
//
// Every model call goes through one gateway that maps a single virtual key to
// real upstream provider keys, so the app never holds Anthropic/OpenAI/Google
// keys directly and we can switch providers or add models without touching
// callers. Two deployment shapes are supported:
//
//   * Default (Family): OpenRouter as the gateway — one key, hundreds of models,
//     OSS + paid, with automatic fallbacks.
//   * Self-hosted (School): a LiteLLM/OpenAI-compatible gateway you run in-region
//     for data residency, pointed at by LYRA_GATEWAY_BASE_URL/API_KEY.
//
// BYOK: a tenant that brings its own provider account can be mapped to its own
// gateway/key via LYRA_TENANT_GATEWAYS (JSON: tenantId -> {baseUrl, apiKey}).
// This is a pragmatic config-based mapping; in production those keys belong in a
// real secret manager / KMS, NOT an env var (see docs/DEPLOY.md). The resolver
// returns only a base URL + key — it never logs or returns them elsewhere.

import config from '../config.js';

/**
 * Resolve which upstream gateway + key to use for a tenant.
 * @returns {{ baseUrl: string, apiKey: string, byok: boolean }}
 */
export function resolveGateway(tenantId) {
  const perTenant = tenantId && config.gateway.tenantGateways?.[tenantId];
  if (perTenant && perTenant.apiKey) {
    return {
      baseUrl: perTenant.baseUrl || config.gateway.baseUrl,
      apiKey: perTenant.apiKey,
      byok: true,
    };
  }
  return { baseUrl: config.gateway.baseUrl, apiKey: config.gateway.apiKey, byok: false };
}
