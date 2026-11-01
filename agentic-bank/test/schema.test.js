import test from 'node:test';
import assert from 'node:assert/strict';
import { validate, assertSchemaSupported, describeErrors } from '../src/kernel/schema.js';
import { buildRegistry, toolName } from '../src/capabilities/index.js';
import { toolSchema } from '../src/capabilities/registry.js';

test('rejects a schema keyword it would otherwise ignore', () => {
  // A keyword this validator does not implement would silently constrain
  // nothing, which is worse than refusing the schema.
  assert.throws(
    () => assertSchemaSupported({ type: 'object', oneOf: [{ type: 'string' }] }),
    /Unsupported schema keyword "oneOf"/,
  );
});

test('an absent optional field is not an error', () => {
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['a'],
    properties: { a: { type: 'string' }, b: { type: 'string' } },
  };
  assert.equal(validate(schema, { a: 'x' }).valid, true);
  assert.equal(validate(schema, {}).errors[0].code, 'REQUIRED');
});

test('additionalProperties:false rejects an injected field', () => {
  const schema = {
    type: 'object', additionalProperties: false, properties: { a: { type: 'string' } },
  };
  const result = validate(schema, { a: 'x', skipScreening: true });
  assert.equal(result.valid, false);
  assert.equal(result.errors[0].code, 'ADDITIONAL');
});

test('defaults are applied', () => {
  const schema = { type: 'object', properties: { p: { type: 'string', default: 'normal' } } };
  assert.equal(validate(schema, {}).value.p, 'normal');
});

test('validates nested arrays of objects with a path', () => {
  const schema = {
    type: 'object',
    properties: {
      lines: { type: 'array', minItems: 1, items: { type: 'object', required: ['to'], properties: { to: { type: 'string' } } } },
    },
  };
  const result = validate(schema, { lines: [{ to: 'a' }, {}] });
  assert.equal(result.errors[0].path, '$.lines[1].to');
  assert.equal(validate(schema, { lines: [] }).errors[0].code, 'MIN_ITEMS');
});

test('formats, patterns and bounds are enforced', () => {
  const schema = {
    type: 'object',
    properties: {
      amount: { type: 'string', format: 'amount' },
      currency: { type: 'string', format: 'currency' },
      count: { type: 'integer', minimum: 1, maximum: 10 },
      code: { type: 'string', pattern: '^[A-Z]{4}$' },
    },
  };
  const bad = validate(schema, { amount: 'lots', currency: 'aud', count: 99, code: 'nope' });
  assert.deepEqual(bad.errors.map((e) => e.code).sort(), ['FORMAT', 'FORMAT', 'MAXIMUM', 'PATTERN']);
  assert.equal(validate(schema, { amount: '1.00', currency: 'AUD', count: 5, code: 'GDDS' }).valid, true);
});

test('an unknown format is reported, never silently accepted', () => {
  const result = validate({ type: 'string', format: 'definitely-not-a-format' }, 'x');
  assert.equal(result.errors[0].code, 'FORMAT_UNKNOWN');
});

test('every registered capability has a schema this validator supports', () => {
  const registry = buildRegistry();
  for (const capability of registry.list({})) {
    assert.doesNotThrow(
      () => assertSchemaSupported(capability.input, capability.id),
      `${capability.id} has an unsupported schema`,
    );
    // Arguments come from a language model, so the object must be closed.
    assert.equal(
      capability.input.additionalProperties, false,
      `${capability.id} must set additionalProperties:false`,
    );
  }
});

test('tool names are valid and round-trip to their capability', () => {
  const registry = buildRegistry();
  for (const capability of registry.list({})) {
    const name = toolName(capability.id);
    assert.match(name, /^[a-zA-Z0-9_-]{1,64}$/, `${name} is not a valid tool name`);
    assert.equal(registry.getByToolName(name).id, capability.id);
  }
});

test('tool schemas carry no non-standard format keyword', () => {
  const registry = buildRegistry();
  const standard = new Set(['date', 'date-time']);
  for (const definition of registry.toolDefinitions({ segment: 'institutional' })) {
    for (const found of JSON.stringify(definition.input_schema).matchAll(/"format":"([^"]+)"/g)) {
      assert.ok(standard.has(found[1]), `${definition.name} leaks custom format "${found[1]}"`);
    }
  }
});

test('compiling a custom format keeps the constraint as a pattern', () => {
  const compiled = toolSchema({ type: 'string', format: 'amount', description: 'Amount.' });
  assert.equal(compiled.format, undefined);
  assert.ok(compiled.pattern);
  assert.match(compiled.description, /Amount\./);
  assert.equal(new RegExp(compiled.pattern).test('1250.00'), true);
  assert.equal(new RegExp(compiled.pattern).test('lots'), false);
});

test('describeErrors is readable enough to hand back to a model', () => {
  const result = validate(
    { type: 'object', required: ['a'], additionalProperties: false, properties: { a: { type: 'string' } } },
    { b: 1 },
  );
  assert.match(describeErrors(result.errors), /\$\.a: is required/);
});
