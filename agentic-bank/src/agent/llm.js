// The model layer.
//
// Two providers behind one interface:
//
//   anthropic — the real thing, via the official SDK.
//   stub      — a deterministic, offline planner. The test suite and the demo
//               run on it, which matters more than it sounds: it means every
//               control in this repo is verified without a network call and
//               without a bill, and a CI failure is a real failure rather than
//               a sampling artefact.
//
// Both return the same shape, so the runtime does not know which it is talking
// to. Nothing below this line knows anything about banking.

export const DEFAULT_MODEL = 'claude-opus-5-5';

export class LlmError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'LlmError';
    this.code = code;
    this.details = details;
  }
}

/**
 * The real provider.
 *
 * The SDK is imported dynamically so the bank boots, tests and demos without it
 * installed; selecting this provider without the dependency is a clear error
 * rather than a crash at the first customer message.
 */
export function anthropicProvider({
  apiKey,
  model = DEFAULT_MODEL,
  effort = 'high',
  maxTokens = 16000,
} = {}) {
  let clientPromise = null;

  async function client() {
    if (!clientPromise) {
      clientPromise = (async () => {
        let Anthropic;
        try {
          ({ default: Anthropic } = await import('@anthropic-ai/sdk'));
        } catch (err) {
          throw new LlmError(
            'AGENT_PROVIDER=anthropic needs @anthropic-ai/sdk; run `npm install`',
            'LLM_SDK_MISSING',
            { cause: err.message },
          );
        }
        // With no apiKey the SDK resolves ANTHROPIC_API_KEY, then
        // ANTHROPIC_AUTH_TOKEN, then an `ant auth login` profile.
        return apiKey ? new Anthropic({ apiKey }) : new Anthropic();
      })();
    }
    return clientPromise;
  }

  return {
    name: 'anthropic',
    model,

    async converse({ system, messages, tools }) {
      const anthropic = await client();

      const response = await anthropic.messages.create({
        model,
        max_tokens: maxTokens,
        // Thinking is always on for this model family; `adaptive` lets it
        // decide how much a given instruction warrants. Depth is governed by
        // effort, whose default on Opus 5.5 is `medium` — so it is set here
        // rather than left implicit.
        thinking: { type: 'adaptive' },
        output_config: { effort },
        // `tools` renders before `system`, so the cache breakpoint goes on the
        // last system block: the capability catalogue and the segment prompt
        // are identical across every turn of every conversation for a segment,
        // and that prefix is the bulk of the request.
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        tools,
        messages,
      });

      // A safety decline arrives as HTTP 200 with stop_reason "refusal", so
      // stop_reason is checked before content is read.
      if (response.stop_reason === 'refusal') {
        throw new LlmError(
          'The model declined to continue this conversation',
          'LLM_REFUSAL',
          { category: response.stop_details?.category ?? null },
        );
      }

      return {
        content: response.content,
        stopReason: response.stop_reason,
        model: response.model,
        usage: {
          inputTokens: response.usage?.input_tokens ?? null,
          outputTokens: response.usage?.output_tokens ?? null,
          cacheReadTokens: response.usage?.cache_read_input_tokens ?? null,
          cacheWriteTokens: response.usage?.cache_creation_input_tokens ?? null,
        },
      };
    },
  };
}

/**
 * The offline provider.
 *
 * `plans` is an ordered list of `{ match, steps }`. The first plan whose
 * `match` tests true against the opening user message is used, and `steps` are
 * emitted one per assistant turn. A step is either `{ tool, input }` (emit a
 * tool_use block) or `{ text }` (end the turn).
 */
export function stubProvider({ plans = [], model = 'stub-planner' } = {}) {
  return {
    name: 'stub',
    model,

    async converse({ messages, tools }) {
      const firstUserText = extractText(messages.find((m) => m.role === 'user'));
      const turn = messages.filter((m) => m.role === 'assistant').length;
      const plan = plans.find((p) => p.match.test(firstUserText));

      if (!plan) {
        return endTurn(
          `I can help with: ${tools.map((t) => t.name).join(', ')}. `
          + 'The offline planner has no script for that request.',
        );
      }

      const step = plan.steps[turn];
      if (!step) {
        return endTurn(plan.closing ?? 'Done.');
      }
      if (step.text !== undefined) {
        return endTurn(step.text);
      }

      // Resolve any `$ref` placeholders against earlier tool results, so a
      // scripted plan can use an id the bank only just minted.
      const input = resolveRefs(step.input, messages);

      return {
        content: [
          ...(step.preamble ? [{ type: 'text', text: step.preamble }] : []),
          { type: 'tool_use', id: `stub_${turn}_${step.tool}`, name: step.tool, input },
        ],
        stopReason: 'tool_use',
        model,
        usage: { inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null },
      };
    },
  };

  function endTurn(text) {
    return {
      content: [{ type: 'text', text }],
      stopReason: 'end_turn',
      model,
      usage: { inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null },
    };
  }
}

function extractText(message) {
  if (!message) return '';
  if (typeof message.content === 'string') return message.content;
  return (message.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join(' ');
}

/**
 * `{ $ref: 'counterpartyId' }` becomes the first `counterpartyId` found in any
 * prior tool_result body. Lets the stub chain calls the way a model would.
 */
function resolveRefs(input, messages) {
  if (Array.isArray(input)) return input.map((v) => resolveRefs(v, messages));
  if (input === null || typeof input !== 'object') return input;
  if (typeof input.$ref === 'string') {
    const found = findInToolResults(messages, input.$ref);
    if (found === undefined) {
      throw new LlmError(
        `Offline planner could not resolve $ref "${input.$ref}" from earlier results`,
        'STUB_REF_UNRESOLVED',
      );
    }
    return found;
  }
  return Object.fromEntries(Object.entries(input).map(([k, v]) => [k, resolveRefs(v, messages)]));
}

function findInToolResults(messages, key) {
  for (const message of [...messages].reverse()) {
    if (message.role !== 'user' || typeof message.content === 'string') continue;
    for (const block of message.content) {
      if (block.type !== 'tool_result') continue;
      let parsed;
      try {
        parsed = JSON.parse(typeof block.content === 'string' ? block.content : '{}');
      } catch {
        continue;
      }
      const hit = search(parsed, key);
      if (hit !== undefined) return hit;
    }
  }
  return undefined;
}

function search(value, key) {
  if (value === null || typeof value !== 'object') return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = search(item, key);
      if (hit !== undefined) return hit;
    }
    return undefined;
  }
  if (value[key] !== undefined && typeof value[key] !== 'object') return value[key];
  for (const child of Object.values(value)) {
    const hit = search(child, key);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

export function createLlm(config) {
  if (config.agentProvider === 'anthropic') {
    return anthropicProvider({
      apiKey: config.anthropicApiKey,
      model: config.agentModel,
      effort: config.agentEffort,
    });
  }
  return stubProvider({ plans: config.stubPlans ?? [] });
}
