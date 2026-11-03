// Text-to-speech adapter. One function per provider, chosen by VOICE_PROVIDER.
//
// HONESTY NOTE: these request shapes are written from each provider's published
// API and have NOT been run against a live key in this repository. If a field
// name has moved, the call fails, `synthesize` returns null, and the app falls
// back to the browser voice — the demo still works. Run `npm run voice` once
// with your key to prove the path before you rely on it.

const PROVIDERS = {
  // Cheapest commercial entry and the lowest latency, which is what matters
  // once this is on a real phone line.
  async cartesia(text, env) {
    const res = await fetch('https://api.cartesia.ai/tts/bytes', {
      method: 'POST',
      headers: {
        'X-API-Key': env.CARTESIA_API_KEY,
        'Cartesia-Version': '2024-06-10',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model_id: env.CARTESIA_MODEL || 'sonic-2',
        transcript: text,
        voice: { mode: 'id', id: env.CARTESIA_VOICE_ID },
        output_format: { container: 'mp3', sample_rate: 44100, bit_rate: 128000 },
        language: 'en',
      }),
    });
    if (!res.ok) throw new Error(`cartesia ${res.status}: ${await res.text()}`);
    return Buffer.from(await res.arrayBuffer());
  },

  async elevenlabs(text, env) {
    const voice = env.ELEVENLABS_VOICE_ID;
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
      method: 'POST',
      headers: { 'xi-api-key': env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        model_id: env.ELEVENLABS_MODEL || 'eleven_flash_v2_5',
      }),
    });
    if (!res.ok) throw new Error(`elevenlabs ${res.status}: ${await res.text()}`);
    return Buffer.from(await res.arrayBuffer());
  },

  async openai(text, env) {
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: env.OPENAI_TTS_MODEL || 'tts-1', voice: env.OPENAI_VOICE || 'alloy', input: text }),
    });
    if (!res.ok) throw new Error(`openai ${res.status}: ${await res.text()}`);
    return Buffer.from(await res.arrayBuffer());
  },
};

export function configuredProvider(env = process.env) {
  const name = (env.VOICE_PROVIDER || '').toLowerCase();
  if (name && PROVIDERS[name]) return name;
  if (env.CARTESIA_API_KEY) return 'cartesia';
  if (env.ELEVENLABS_API_KEY) return 'elevenlabs';
  if (env.OPENAI_API_KEY) return 'openai';
  return null;
}

/** Returns an MP3 Buffer, or null when no provider is configured. */
export async function synthesize(text, env = process.env) {
  const name = configuredProvider(env);
  if (!name) return null;
  return PROVIDERS[name](text, env);
}

export const providerNames = Object.keys(PROVIDERS);
