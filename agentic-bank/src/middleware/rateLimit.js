// Fixed-window limiter, per key. In-process, so it is per-instance — behind
// more than one instance this is a speed bump, not a limit. A real deployment
// puts the limit at the edge as well.
export function rateLimit({ windowMs = 60_000, max = 60, keyPrefix = 'rl' } = {}) {
  const buckets = new Map();

  return (req, res, next) => {
    const identity = req.identity?.actor?.id ?? req.ip ?? 'anonymous';
    const key = `${keyPrefix}:${identity}`;
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || now >= bucket.resetAt) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    bucket.count += 1;
    if (bucket.count > max) {
      res.setHeader('Retry-After', Math.ceil((bucket.resetAt - now) / 1000));
      return res.status(429).json({
        error: 'RATE_LIMITED',
        message: `More than ${max} requests in ${windowMs / 1000}s`,
      });
    }
    return next();
  };
}
