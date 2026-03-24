export function createRateLimiter({ windowSec, limitByKey }) {
  const buckets = new Map();
  const windowMs = windowSec * 1000;

  function allow(key, limit) {
    const now = Date.now();
    const activeLimit = limit || limitByKey;
    const current = buckets.get(key);
    if (!current || now > current.resetAt) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return { ok: true, remaining: activeLimit - 1, resetAt: now + windowMs };
    }
    if (current.count >= activeLimit) {
      return { ok: false, remaining: 0, resetAt: current.resetAt };
    }
    current.count += 1;
    return { ok: true, remaining: activeLimit - current.count, resetAt: current.resetAt };
  }

  return { allow };
}
