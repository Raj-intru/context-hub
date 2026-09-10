// Async route wrapper + centralized error handler.

export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  // Typed errors carry a clean status/code; everything else is a 500 and is
  // logged server-side but not leaked to the client.
  const status = err.status || 500;
  const code = err.code || 'INTERNAL_ERROR';
  if (status >= 500) {
    console.error('[error]', req.method, req.originalUrl, err);
  }
  const body = { error: code };
  if (status < 500 && err.message && err.message !== code) {
    body.message = err.message;
  }
  res.status(status).json(body);
}
