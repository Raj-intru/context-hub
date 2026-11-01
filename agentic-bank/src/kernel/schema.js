// A small JSON Schema subset validator.
//
// Dependency-free on purpose: this validates every argument a language model
// hands the bank, so it is on the critical path for correctness and belongs in
// code this repo can read end to end. It covers the subset the capability
// registry uses and rejects — loudly — any keyword it does not implement, so a
// schema cannot silently fail to constrain anything.

const SUPPORTED = new Set([
  'type', 'properties', 'required', 'additionalProperties', 'items', 'enum',
  'pattern', 'minimum', 'maximum', 'minLength', 'maxLength', 'minItems',
  'maxItems', 'description', 'format', 'default', 'title', 'examples',
]);

const FORMATS = {
  date: /^\d{4}-\d{2}-\d{2}$/,
  'date-time': /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/,
  currency: /^[A-Z]{3}$/,
  // A decimal amount as a string. Precision against the currency is checked by
  // money.parseDecimal — this only rejects obvious nonsense early.
  amount: /^-?\d{1,18}(\.\d{1,3})?$/,
  iban: /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/,
  bic: /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/,
  identifier: /^[A-Za-z0-9_\-:.]{1,128}$/,
};

export class SchemaError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SchemaError';
  }
}

/** Throws if a schema uses a keyword this validator would ignore. */
export function assertSchemaSupported(schema, path = '$') {
  if (!schema || typeof schema !== 'object') {
    throw new SchemaError(`Schema at ${path} must be an object`);
  }
  for (const key of Object.keys(schema)) {
    if (!SUPPORTED.has(key)) {
      throw new SchemaError(`Unsupported schema keyword "${key}" at ${path}`);
    }
  }
  if (schema.properties) {
    for (const [key, sub] of Object.entries(schema.properties)) {
      assertSchemaSupported(sub, `${path}.${key}`);
    }
  }
  if (schema.items) assertSchemaSupported(schema.items, `${path}[]`);
  return true;
}

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function matchesType(value, expected) {
  if (expected === 'integer') return Number.isInteger(value);
  if (expected === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (expected === 'array') return Array.isArray(value);
  if (expected === 'null') return value === null;
  if (expected === 'object') {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }
  return typeof value === expected;
}

/**
 * Validate `value` against `schema`.
 * Returns `{ valid, errors: [{ path, code, message }], value }` where `value`
 * has defaults applied. Never throws on bad input — bad input is the point.
 */
export function validate(schema, value, path = '$') {
  const errors = [];
  const out = walk(schema, value, path, errors);
  return { valid: errors.length === 0, errors, value: out };
}

function walk(schema, value, path, errors) {
  if (value === undefined && schema.default !== undefined) {
    value = structuredClone(schema.default);
  }

  // An absent value is not a type error. Whether absence is allowed at all is
  // decided by `required` on the parent object, which has already run.
  if (value === undefined) return undefined;

  if (schema.type && !matchesType(value, schema.type)) {
    errors.push({
      path,
      code: 'TYPE',
      message: `expected ${schema.type}, got ${typeOf(value)}`,
    });
    return value;
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push({
      path,
      code: 'ENUM',
      message: `must be one of: ${schema.enum.join(', ')}`,
    });
  }

  if (typeof value === 'string') {
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      errors.push({ path, code: 'PATTERN', message: `does not match ${schema.pattern}` });
    }
    if (schema.format) {
      const rule = FORMATS[schema.format];
      if (!rule) {
        errors.push({ path, code: 'FORMAT_UNKNOWN', message: `unknown format ${schema.format}` });
      } else if (!rule.test(value)) {
        errors.push({ path, code: 'FORMAT', message: `is not a valid ${schema.format}` });
      }
    }
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push({ path, code: 'MIN_LENGTH', message: `shorter than ${schema.minLength}` });
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push({ path, code: 'MAX_LENGTH', message: `longer than ${schema.maxLength}` });
    }
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push({ path, code: 'MINIMUM', message: `below ${schema.minimum}` });
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push({ path, code: 'MAXIMUM', message: `above ${schema.maximum}` });
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push({ path, code: 'MIN_ITEMS', message: `needs at least ${schema.minItems} item(s)` });
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push({ path, code: 'MAX_ITEMS', message: `at most ${schema.maxItems} item(s)` });
    }
    if (schema.items) {
      return value.map((item, i) => walk(schema.items, item, `${path}[${i}]`, errors));
    }
    return value;
  }

  if (schema.type === 'object' || schema.properties) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      if (value !== undefined) {
        errors.push({ path, code: 'TYPE', message: `expected object, got ${typeOf(value)}` });
      }
      return value;
    }
    const result = {};
    const properties = schema.properties ?? {};

    for (const key of schema.required ?? []) {
      if (value[key] === undefined && properties[key]?.default === undefined) {
        errors.push({ path: `${path}.${key}`, code: 'REQUIRED', message: 'is required' });
      }
    }

    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(properties, key)) {
          errors.push({
            path: `${path}.${key}`,
            code: 'ADDITIONAL',
            message: 'is not a recognised field',
          });
        }
      }
    }

    for (const [key, sub] of Object.entries(properties)) {
      const child = walk(sub, value[key], `${path}.${key}`, errors);
      if (child !== undefined) result[key] = child;
    }
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(properties, key) && schema.additionalProperties !== false) {
        result[key] = value[key];
      }
    }
    return result;
  }

  return value;
}

/** Human-readable error summary, used in tool_result bodies sent back to the model. */
export function describeErrors(errors) {
  return errors.map((e) => `${e.path}: ${e.message}`).join('; ');
}
