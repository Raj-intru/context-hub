// Minimal in-memory fixed-window rate limiter (no external dependency).
// Good enough for a single instance; for horizontally-scaled deployments back
// this with Redis (noted in docs/DEPLOY.md).

const buckets = new Map();

export function rateLimit({ windowMs = 60_000, max = 60, keyPrefix = 'rl' } = {}) {
  return (req, res, next) => {
    const now = Date.now();
    const key = `${keyPrefix}:${req.ip}`;
    let entry = buckets.get(key);
    if (!entry || entry.reset < now) {
      entry = { count: 0, reset: now + windowMs };
      buckets.set(key, entry);
    }
    entry.count += 1;
    const remaining = Math.max(0, max - entry.count);
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    if (entry.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((entry.reset - now) / 1000)));
      return res.status(429).json({ error: 'RATE_LIMITED', message: 'Too many requests, slow down.' });
    }
    next();
  };
}

// Periodically evict stale buckets to bound memory.
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
}, 5 * 60_000);
sweeper.unref?.();
