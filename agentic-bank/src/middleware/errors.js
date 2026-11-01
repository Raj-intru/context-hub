/**
 * Errors that are the caller's fault must not be reported as the bank's.
 * A 500 hides its message by design, so a mis-mapped validation error becomes
 * "Internal error" and the caller never learns that they sent an amount as a
 * JSON number.
 */
const STATUS_BY_NAME = {
  SchemaError: 400,
  MoneyError: 400,
  CapabilityError: 400,
  MandateError: 400,
  AgentError: 400,
  ApprovalError: 409,
  LedgerError: 422,
  FxError: 422,
};

export function errorHandler(err, req, res, _next) {
  const status = err.status ?? STATUS_BY_NAME[err.name] ?? 500;
  const body = {
    error: err.code ?? err.name ?? 'INTERNAL',
    message: status >= 500 ? 'Internal error' : err.message,
  };
  if (err.details && status < 500) body.details = err.details;
  if (status >= 500) {
    // Never leak internals to a caller; always leave them in the log.
    console.error('[agentic-bank]', req.method, req.path, err);
  }
  res.status(status).json(body);
}

export function notFound(req, res) {
  res.status(404).json({ error: 'NOT_FOUND', message: `No route ${req.method} ${req.path}` });
}

/** Wrap an async handler so a rejection reaches errorHandler. */
export function handler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
