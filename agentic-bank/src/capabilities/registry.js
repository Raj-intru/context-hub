// The capability registry: the bank's product surface, declared once.
//
// A capability is the only unit of banking functionality in this system. Each
// one is declared with a JSON Schema for its arguments, a risk class, the
// segments it serves, and two functions — `plan` (work out what this would do)
// and `execute` (do it, only ever after a policy ALLOW).
//
// The same registry is projected three ways, which is what "API-first" has to
// mean for an agentic bank:
//
//   1. as tool definitions for the bank's own agent,
//   2. as REST endpoints at /v1/capabilities/:id/execute, for direct integration,
//   3. as a machine-readable catalogue at /v1/agent/capabilities, so a
//      customer's own agent can discover and call the bank directly.
//
// One declaration, three surfaces. A capability cannot exist on one and not the
// others, so the mobile app can never quietly get a privileged path.

import { assertSchemaSupported, validate, describeErrors } from '../kernel/schema.js';

export const RISK_CLASSES = ['read', 'low', 'medium', 'high'];
export const SEGMENTS = ['consumer', 'business', 'institutional'];

export class CapabilityError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'CapabilityError';
    this.code = code;
    this.details = details;
  }
}

/** `payments.domestic.initiate` -> `payments_domestic_initiate` (tool-name safe). */
export function toolName(capabilityId) {
  return capabilityId.replace(/\./g, '_');
}

/**
 * Custom `format` names, compiled to the standard keywords a generic JSON
 * Schema consumer honours. `date` and `date-time` are standard formats and pass
 * through untouched.
 */
const FORMAT_COMPILATION = {
  amount: {
    pattern: '^-?\\d{1,18}(\\.\\d{1,3})?$',
    note: 'Decimal amount as a string, e.g. "1250.00". Never send a JSON number.',
  },
  currency: { pattern: '^[A-Z]{3}$', note: 'ISO-4217 currency code.' },
  identifier: { pattern: '^[A-Za-z0-9_\\-:.]{1,128}$', note: 'An identifier returned by a previous call.' },
  iban: { pattern: '^[A-Z]{2}\\d{2}[A-Z0-9]{10,30}$', note: 'IBAN.' },
  bic: { pattern: '^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$', note: 'SWIFT BIC.' },
};

const STANDARD_FORMATS = new Set(['date', 'date-time']);

export function toolSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  const out = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'properties') {
      out.properties = Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, toolSchema(v)]),
      );
      continue;
    }
    if (key === 'items') {
      out.items = toolSchema(value);
      continue;
    }
    if (key === 'format' && !STANDARD_FORMATS.has(value)) {
      const compiled = FORMAT_COMPILATION[value];
      if (compiled) {
        if (!schema.pattern) out.pattern = compiled.pattern;
        out.description = [schema.description, compiled.note].filter(Boolean).join(' ');
      }
      continue;
    }
    if (key === 'description' && out.description) continue;
    out[key] = value;
  }
  return out;
}

export function createRegistry() {
  const capabilities = new Map();
  const byToolName = new Map();

  return {
    register(capability) {
      const { id, title, description, input, plan, execute } = capability;
      if (!id || !/^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*)+$/.test(id)) {
        throw new CapabilityError(`Malformed capability id: ${id}`, 'CAPABILITY_BAD_ID');
      }
      if (capabilities.has(id)) {
        throw new CapabilityError(`Capability ${id} is already registered`, 'CAPABILITY_DUPLICATE');
      }
      if (!title || !description) {
        throw new CapabilityError(`Capability ${id} needs a title and description`, 'CAPABILITY_NO_DESCRIPTION');
      }
      if (!RISK_CLASSES.includes(capability.riskClass)) {
        throw new CapabilityError(
          `Capability ${id} has an unknown risk class: ${capability.riskClass}`,
          'CAPABILITY_BAD_RISK_CLASS',
        );
      }
      for (const segment of capability.segments ?? []) {
        if (!SEGMENTS.includes(segment)) {
          throw new CapabilityError(`Capability ${id} names an unknown segment: ${segment}`, 'CAPABILITY_BAD_SEGMENT');
        }
      }
      if (!input) throw new CapabilityError(`Capability ${id} needs an input schema`, 'CAPABILITY_NO_SCHEMA');
      assertSchemaSupported(input, `${id}.input`);
      if (typeof plan !== 'function') {
        throw new CapabilityError(`Capability ${id} needs a plan()`, 'CAPABILITY_NO_PLAN');
      }
      if (capability.mutating && typeof execute !== 'function') {
        throw new CapabilityError(`Mutating capability ${id} needs an execute()`, 'CAPABILITY_NO_EXECUTE');
      }
      // A read capability must not claim to move money, and a mutating one must
      // declare its risk honestly: these two mistakes are the ones that would
      // let something slip past the policy engine.
      if (!capability.mutating && capability.riskClass !== 'read') {
        throw new CapabilityError(
          `Capability ${id} is non-mutating so its risk class must be "read"`,
          'CAPABILITY_RISK_MISMATCH',
        );
      }
      if (capability.mutating && capability.riskClass === 'read') {
        throw new CapabilityError(
          `Capability ${id} mutates state so it cannot be risk class "read"`,
          'CAPABILITY_RISK_MISMATCH',
        );
      }

      const frozen = Object.freeze({
        enabled: true,
        segments: SEGMENTS,
        mutating: false,
        requiresCounterparty: false,
        debitsFunds: false,
        requiresKyc: true,
        rail: null,
        ...capability,
      });
      capabilities.set(id, frozen);
      byToolName.set(toolName(id), frozen);
      return frozen;
    },

    get(id) {
      return capabilities.get(id) ?? null;
    },

    getByToolName(name) {
      return byToolName.get(name) ?? null;
    },

    list({ segment = null, mutating = null, enabledOnly = true } = {}) {
      return [...capabilities.values()].filter((c) => {
        if (enabledOnly && !c.enabled) return false;
        if (segment && !c.segments.includes(segment)) return false;
        if (mutating !== null && c.mutating !== mutating) return false;
        return true;
      });
    },

    /** Validate arguments against a capability's schema. */
    validateArgs(capability, args) {
      const result = validate(capability.input, args ?? {});
      if (!result.valid) {
        throw new CapabilityError(
          `Invalid arguments for ${capability.id}: ${describeErrors(result.errors)}`,
          'CAPABILITY_BAD_ARGS',
          { errors: result.errors },
        );
      }
      return result.value;
    },

    /**
     * Anthropic tool definitions for a segment.
     *
     * `strict: true` plus `additionalProperties: false` on every schema means
     * the model's arguments are schema-valid before they reach the bank. They
     * are still validated again here — a tool definition is a hint to the
     * model, never a guarantee to the kernel.
     *
     * Internal schemas use custom `format` names (`amount`, `identifier`, ...)
     * that mean something to this repo's validator and nothing to anyone else.
     * `toolSchema` compiles those down to the `pattern` + `description` a
     * standards-compliant consumer understands, so the constraint still reaches
     * the model instead of being silently dropped as an unknown annotation.
     */
    toolDefinitions({ segment, capabilityIds = null } = {}) {
      return this.list({ segment })
        .filter((c) => !capabilityIds || capabilityIds.includes(c.id))
        .map((c) => ({
          name: toolName(c.id),
          description: [
            c.description,
            c.mutating
              ? `Mutating (risk: ${c.riskClass}). The bank's policy engine may still require human approval; you will be told if so.`
              : 'Read-only.',
            c.rail ? `Rail ${c.rail.name}, cut-off ${c.rail.cutOff} ${c.rail.timeZone ?? 'local'}.` : null,
          ]
            .filter(Boolean)
            .join(' '),
          input_schema: toolSchema(c.input),
          strict: true,
        }));
    },

    /** The public catalogue, for a customer's own agent to read. */
    catalogue({ segment = null } = {}) {
      return this.list({ segment }).map((c) => ({
        id: c.id,
        title: c.title,
        description: c.description,
        segments: c.segments,
        riskClass: c.riskClass,
        mutating: c.mutating,
        requiresCounterparty: c.requiresCounterparty,
        debitsFunds: c.debitsFunds,
        rail: c.rail,
        input: c.input,
        endpoint: `/v1/capabilities/${c.id}/execute`,
        tool: toolName(c.id),
      }));
    },

    size() {
      return capabilities.size;
    },
  };
}
